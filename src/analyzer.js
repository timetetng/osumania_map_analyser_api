import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { calculate as calculateSunny } from "../../ManiaMapAnalyser by Leo_Black/js/rework/sunnyAlgorithm.js";
import { OsuFileParser } from "../../ManiaMapAnalyser by Leo_Black/js/parser/osuFileParser.js";
import { SR_INTERVALS } from "../../ManiaMapAnalyser by Leo_Black/js/estimator/intervals.js";
import { estDiff, normalizeReworkResult } from "../../ManiaMapAnalyser by Leo_Black/js/estimator/reworkEstimatorUtils.js";
import { runSunnyEstimatorFromText } from "../../ManiaMapAnalyser by Leo_Black/js/estimator/sunnyEstimator.js";
import { runDanielEstimatorFromText } from "../../ManiaMapAnalyser by Leo_Black/js/estimator/danielEstimator.js";
import { runAzusaEstimatorFromText } from "../../ManiaMapAnalyser by Leo_Black/js/estimator/azusaEstimator.js";
import { runMixedEstimatorFromText } from "../../ManiaMapAnalyser by Leo_Black/js/estimator/mixedEstimator.js";
import { classifyCompanellaDifficulty } from "../../ManiaMapAnalyser by Leo_Black/js/estimator/companellaEstimator.js";
import { analyzePatternFromText } from "../../ManiaMapAnalyser by Leo_Black/js/patterns/service.js";
import { calculateInterludeStar } from "../../ManiaMapAnalyser by Leo_Black/js/interlude/index.js";
import { analyzeEtternaFromText } from "./ett/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function parseOsuFile(osuText) {
    const parser = new OsuFileParser(osuText);
    parser.process();
    return parser.getParsedData();
}

function modToSpeedRate(mods) {
    const modSet = new Set((mods || []).map((m) => String(m).toUpperCase()));
    if (modSet.has("DT") || modSet.has("NC")) return 1.5;
    if (modSet.has("HT")) return 0.75;
    return 1.0;
}

function modToOdfFlag(mods) {
    const modSet = new Set((mods || []).map((m) => String(m).toUpperCase()));
    if (modSet.has("HR")) return "HR";
    if (modSet.has("EZ")) return "EZ";
    return null;
}

function modToCvtFlag(mods) {
    const parts = [];
    const modSet = new Set((mods || []).map((m) => String(m).toUpperCase()));
    if (modSet.has("IN")) parts.push("IN");
    if (modSet.has("HO")) parts.push("HO");
    return parts.length > 0 ? parts.join("") : null;
}

function buildEstimatorOptions(speedRate, odFlag, cvtFlag) {
    return {
        speedRate,
        odFlag,
        cvtFlag,
        withGraph: false,
    };
}

function runEstimator(osuText, algorithm, options) {
    if (algorithm === "Daniel") {
        return runDanielEstimatorFromText(osuText, options);
    }
    if (algorithm === "Azusa") {
        return runAzusaEstimatorFromText(osuText, options);
    }
    if (algorithm === "Mixed") {
        return runMixedEstimatorFromText(osuText, options);
    }
    return runSunnyEstimatorFromText(osuText, options);
}

function isValidResult(result) {
    return result && Number.isFinite(result.star) && Number.isFinite(result.lnRatio);
}

export function analyzeOsuText(osuText, mods = [], options = {}) {
    const algorithm = options.algorithm || "Mixed";
    const speedRate = modToSpeedRate(mods);
    const odFlag = modToOdfFlag(mods);
    const cvtFlag = modToCvtFlag(mods);
    const opts = buildEstimatorOptions(speedRate, odFlag, cvtFlag);

    let rework = runEstimator(osuText, algorithm, opts);

    if (!isValidResult(rework) && algorithm === "Azusa") {
        rework = runSunnyEstimatorFromText(osuText, opts);
    }

    if (!isValidResult(rework)) {
        rework = runSunnyEstimatorFromText(osuText, opts);
        algorithm = "Sunny";
    }

    const normalized = normalizeReworkResult(rework);
    const difficultyLabel = rework.estDiff || estDiff(normalized.star, normalized.lnRatio, normalized.columnCount);

    return {
        starRating: normalized.star,
        lnRatio: normalized.lnRatio,
        columnCount: normalized.columnCount,
        difficultyLabel,
        algorithm,
        speedRate,
        odFlag,
        cvtFlag,
    };
}

export async function fullAnalyzeOsuText(osuText, mods = [], options = {}) {
    const algorithm = options.algorithm || "Mixed";
    const speedRate = modToSpeedRate(mods);
    const odFlag = modToOdfFlag(mods);
    const cvtFlag = modToCvtFlag(mods);
    const opts = buildEstimatorOptions(speedRate, odFlag, cvtFlag);

    let rework = runEstimator(osuText, algorithm, opts);

    if (!isValidResult(rework) && algorithm === "Azusa") {
        rework = runSunnyEstimatorFromText(osuText, opts);
    }

    if (!isValidResult(rework)) {
        rework = runSunnyEstimatorFromText(osuText, opts);
        algorithm = "Sunny";
    }

    const normalized = normalizeReworkResult(rework);
    const difficultyLabel = rework.estDiff || estDiff(normalized.star, normalized.lnRatio, normalized.columnCount);

    let patternResult = null;
    try {
        patternResult = analyzePatternFromText(osuText);
    } catch (_) {}

    let interludeStar = null;
    try {
        interludeStar = await calculateInterludeStar(osuText, speedRate, cvtFlag);
    } catch (_) {}

    let etternaValues = null;
    try {
        const ett = await analyzeEtternaFromText(osuText, {
            musicRate: speedRate,
            cvtFlag,
            etternaVersion: "0.72.3",
        });
        etternaValues = ett?.values || null;
    } catch (_) {}

    let companellaResult = null;
    if (algorithm === "Mixed" && rework?.mixedCompanellaPlan && normalized.columnCount === 4) {
        try {
            companellaResult = await classifyCompanellaDifficulty({
                msdValues: etternaValues,
                interludeStar,
                sunnyStar: normalized.star,
            });
        } catch (_) {}
    }

    return {
        starRating: normalized.star,
        lnRatio: normalized.lnRatio,
        columnCount: normalized.columnCount,
        difficultyLabel,
        algorithm,
        speedRate,
        odFlag,
        cvtFlag,
        patternReport: patternResult?.report || null,
        interludeStar,
        etternaValues,
    };
}