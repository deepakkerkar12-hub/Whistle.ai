const FRIENDLY_ERROR = "Can't load data right now. Please try again later";
const REQUEST_TIMEOUT_MS = 28000;

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "product_name",
    "explicit_claims",
    "implied_claims",
    "ingredients",
    "nutrition_values",
    "brand_grievance_email"
  ],
  properties: {
    product_name: { type: "string" },
    explicit_claims: { type: "array", items: { type: "string" } },
    implied_claims: { type: "array", items: { type: "string" } },
    ingredients: { type: "string" },
    nutrition_values: { type: "string" },
    brand_grievance_email: { type: "string" }
  }
};

const instructions = `You extract factual information from two images of one packaged food product: a front pack and a back pack.

Read the product name exactly as prominently printed on the front pack. Extract explicit claims as exact printed phrases, including text such as product attributes or ingredient claims. For implied claims, describe only visual cues visible in the pack imagery, such as a fish-shaped biscuit, a leaf, fruit imagery, or an animal illustration. Do not convert an implied visual cue into a legal or regulatory conclusion.

Transcribe the full ingredients list in printed order when it is visible. If no ingredients list is visible, return exactly "Ingredients list not visible in the uploaded images.". Transcribe visible nutrition values compactly, preserving the printed nutrient names and quantities. If none are visible, return exactly "Nutrition table not visible in the uploaded images.".

Only return a brand grievance email if it is visibly printed on the pack; otherwise return an empty string. Never invent, normalize, or infer missing text. Return all schema fields, using empty arrays when no claims or visual cues are visible.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: FRIENDLY_ERROR });
  if (!process.env.OPENAI_API_KEY) {
    console.error("Vision extraction unavailable: OPENAI_API_KEY is not configured");
    return res.status(500).json({ error: FRIENDLY_ERROR });
  }

  const { frontImage, backImage } = readRequestBody(req);
  if (!isImageDataUrl(frontImage) || !isImageDataUrl(backImage)) {
    console.error("Vision extraction rejected: package images were missing or unsupported");
    return res.status(400).json({ error: FRIENDLY_ERROR });
  }

  try {
    const extraction = await extractWithRetry(frontImage, backImage);
    return res.status(200).json(extraction);
  } catch (error) {
    console.error("Vision extraction failed", {
      code: error?.code || "unexpected_error",
      status: error?.status || null
    });
    return res.status(502).json({ error: FRIENDLY_ERROR });
  }
}

function readRequestBody(req) {
  if (typeof req.body !== "string") return req.body || {};
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

async function extractWithRetry(frontImage, backImage) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await callVision(frontImage, backImage);
    } catch (error) {
      lastError = error;
      if (!error?.retryable || attempt === 1) throw error;
    }
  }
  throw lastError || new ExtractionError("unexpected_error");
}

async function callVision(frontImage, backImage) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-5-mini",
        store: false,
        reasoning: { effort: "low" },
        max_output_tokens: 1500,
        instructions,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: "Front pack image:" },
            { type: "input_image", image_url: frontImage, detail: "high" },
            { type: "input_text", text: "Back pack image:" },
            { type: "input_image", image_url: backImage, detail: "high" }
          ]
        }],
        text: {
          format: {
            type: "json_schema",
            name: "food_package_extraction",
            strict: true,
            schema: extractionSchema
          }
        }
      })
    });

    const rawPayload = await response.text();
    const payload = parseJson(rawPayload);
    if (!response.ok) {
      throw new ExtractionError(`openai_http_${response.status}`, response.status >= 500 || response.status === 429, response.status);
    }
    if (!payload) throw new ExtractionError("invalid_openai_payload", true);

    const extraction = readStructuredExtraction(payload);
    if (extraction) return extraction;

    throw new ExtractionError("missing_structured_output", true);
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    if (error?.name === "AbortError") throw new ExtractionError("vision_timeout", true);
    throw new ExtractionError("vision_request_failed", true);
  } finally {
    clearTimeout(timer);
  }
}

function readStructuredExtraction(payload) {
  const candidates = [payload.output_text, payload.output_parsed];
  for (const item of payload.output || []) {
    for (const content of item?.content || []) {
      candidates.push(content?.parsed, content?.json, content?.text, content?.arguments);
    }
  }

  for (const candidate of candidates) {
    const parsed = typeof candidate === "string" ? parseJson(candidate) : candidate;
    const normalized = normalizeExtraction(parsed);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeExtraction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const strings = ["product_name", "ingredients", "nutrition_values", "brand_grievance_email"];
  if (!strings.every((key) => typeof value[key] === "string")) return null;
  if (!Array.isArray(value.explicit_claims) || !Array.isArray(value.implied_claims)) return null;

  return {
    product_name: value.product_name,
    explicit_claims: value.explicit_claims.filter((item) => typeof item === "string"),
    implied_claims: value.implied_claims.filter((item) => typeof item === "string"),
    ingredients: value.ingredients,
    nutrition_values: value.nutrition_values,
    brand_grievance_email: value.brand_grievance_email
  };
}

function parseJson(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isImageDataUrl(value) {
  return typeof value === "string" && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value);
}

class ExtractionError extends Error {
  constructor(code, retryable = false, status = null) {
    super(code);
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}
