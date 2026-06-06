import { Router, type IRouter } from "express";

const router: IRouter = Router();

interface DecartConfig {
  apiKey: string;
  model: string;
  endpoint: string;
  mirror: string;
  enhance: boolean;
  prompt: string;
  styleImage: string;
}

let decartConfig: DecartConfig = {
  apiKey: "",
  model: "lucy-2.1",
  endpoint: "wss://api3.decart.ai/v1/stream",
  mirror: "auto",
  enhance: true,
  prompt: "",
  styleImage: "",
};

router.get("/config", (_req, res) => {
  res.json({
    ...decartConfig,
    apiKey: decartConfig.apiKey ? "***" : "",
    styleImage: "",
  });
});

router.put("/config", (req, res) => {
  const { apiKey, model, mirror, enhance, prompt, endpoint } = req.body as Partial<DecartConfig>;
  if (apiKey !== undefined) decartConfig.apiKey = apiKey;
  if (model) decartConfig.model = model;
  if (mirror) decartConfig.mirror = mirror;
  if (enhance !== undefined) decartConfig.enhance = enhance;
  if (prompt !== undefined) decartConfig.prompt = prompt;
  if (endpoint !== undefined) decartConfig.endpoint = endpoint;
  res.json({ ...decartConfig, apiKey: decartConfig.apiKey ? "***" : "", styleImage: "" });
});

router.put("/style-image", (req, res) => {
  const { styleImage } = req.body as { styleImage?: string };
  if (styleImage !== undefined) decartConfig.styleImage = styleImage;
  res.json({ hasImage: !!decartConfig.styleImage });
});

router.get("/style-image", (_req, res) => {
  res.json({ styleImage: decartConfig.styleImage || "" });
});

router.post("/process-frame", async (req, res) => {
  const { frame, prompt, apiKey: reqApiKey } = req.body as {
    frame?: string;
    prompt?: string;
    apiKey?: string;
  };

  const key = reqApiKey || decartConfig.apiKey;
  if (!key) {
    res.status(400).json({ error: "API key required" });
    return;
  }
  if (!frame) {
    res.status(400).json({ error: "frame (base64 JPEG) required" });
    return;
  }

  try {
    const base64Data = frame.replace(/^data:image\/\w+;base64,/, "");
    const imageBuffer = Buffer.from(base64Data, "base64");

    const formData = new FormData();
    formData.append("prompt", prompt || decartConfig.prompt || "Enhance and stylize");
    formData.append("data", new Blob([imageBuffer], { type: "image/jpeg" }), "frame.jpg");
    if (decartConfig.styleImage) {
      const refData = decartConfig.styleImage.replace(/^data:image\/\w+;base64,/, "");
      const refBuf = Buffer.from(refData, "base64");
      formData.append("reference_image", new Blob([refBuf], { type: "image/jpeg" }), "style.jpg");
    }

    const submitRes = await fetch("https://api.decart.ai/v1/jobs/lucy-image-2", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: formData,
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      res.status(submitRes.status).json({ error: `Decart API error: ${errText}` });
      return;
    }

    const job = await submitRes.json() as { job_id: string; status?: string };
    const jobId = job.job_id;

    const start = Date.now();
    while (Date.now() - start < 30000) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(`https://api.decart.ai/v1/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      const result = await pollRes.json() as {
        job_id: string;
        status: string;
        error?: string;
      };

      if (result.status === "completed") {
        const contentRes = await fetch(`https://api.decart.ai/v1/jobs/${jobId}/content`, {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!contentRes.ok) {
          res.status(500).json({ error: "Failed to fetch job content" });
          return;
        }
        const blob = await contentRes.arrayBuffer();
        const base64 = Buffer.from(blob).toString("base64");
        const contentType = contentRes.headers.get("content-type") || "image/jpeg";
        res.json({
          status: "completed",
          outputDataUrl: `data:${contentType};base64,${base64}`,
          jobId,
        });
        return;
      }
      if (result.status === "failed") {
        res.status(500).json({ error: result.error || "Job failed" });
        return;
      }
    }

    res.status(408).json({ error: "Timeout waiting for Decart result", jobId });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
