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

const instructions = \`You extract factual information from two images of one packaged food product: a front pack and a back pack.

Read the product name exactly as prominently printed on the front pack. Extract explicit claims as exact printed phrases, including text such as product attributes or ingredient claims. For implied claims, describe only visual cues visible in the pack imagery, such as a fish-shaped biscuit, a leaf, fruit imagery, or an animal illustration. Do not convert an implied visual cue into a legal or regulatory conclusion.

Transcribe the full ingredients list in printed order when it is visible. If no ingredients list is visible, return exactly "Ingredients list not visible in the uploaded images.". Transcribe visible nutrition values compactly, preserving the printed nutrient names and quantities. If none are visible, return exactly "Nutrition table not visible in the uploaded images.".

Only return a brand grievance email if it is visibly printed on the pack; otherwise return an empty string. Never invent, normalize, or infer missing text. Return all schema fields, using empty arrays when no claims or visual cues are visible.\`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY is not configured" });

  const { frontImage, backImage } = req.body || {};
  if (!isImageDataUrl(frontImage) || !isImageDataUrl(backImage)) {
    return res.status(400).json({ error: "Two package images are required" });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: \`Bearer \${process.env.OPENAI_API_KEY}\`
      },
      body: JSON.stringify({
        model: "gpt-5",
        store: false,
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
    const payload = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: payload.error?.message || "OpenAI Vision request failed" });
    return res.status(200).json(JSON.parse(payload.output_text));
  } catch (error) {
    return res.status(500).json({ error: error.message || "Extraction service failed" });
  }
}

function isImageDataUrl(value) {
  return typeof value === "string" && /^data:image\\/(png|jpe?g|webp|gif);base64,/i.test(value);
}
