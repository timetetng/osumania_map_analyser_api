import express from "express";
import multer from "multer";
import { Readable } from "stream";
import unzipper from "unzipper";
import { analyzeOsuText, fullAnalyzeOsuText } from "./analyzer.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

app.post("/analyze", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        const mods = req.body.mods
            ? Array.isArray(req.body.mods)
                ? req.body.mods
                : [req.body.mods]
            : [];

        const includeExtras = req.body.includeExtras === "true" || req.body.includeExtras === true;
        const algorithm = req.body.algorithm || "Mixed";

        const zipBuffer = Buffer.from(req.file.buffer);
        const directory = await unzipper.Open.buffer(zipBuffer);
        const allOsuEntries = directory.files.filter((f) => f.path.endsWith(".osu") && !f.path.startsWith("_"));

        if (allOsuEntries.length === 0) {
            return res.status(400).json({ error: "No .osu file found in .osz archive" });
        }

        let bestEntry = null;
        let bestSr = -1;

        for (const entry of allOsuEntries) {
            const osuText = (await entry.buffer()).toString("utf-8");
            const result = analyzeOsuText(osuText, mods, { algorithm });
            if (result.starRating > bestSr) {
                bestSr = result.starRating;
                bestEntry = entry;
            }
        }

        const osuText = (await bestEntry.buffer()).toString("utf-8");
        const result = includeExtras
            ? await fullAnalyzeOsuText(osuText, mods, { algorithm })
            : analyzeOsuText(osuText, mods, { algorithm });

        res.json({
            success: true,
            filename: req.file.originalname,
            analyzedPath: bestEntry.path,
            totalDifficulties: allOsuEntries.length,
            result,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Mania Map Analyser API running on http://localhost:${PORT}`);
    console.log(`POST /analyze with multipart/form-data file field 'file' (.osz) and mods[] query params`);
});