import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { pathToFileURL } from "url";

const ETTERNA_VERSION_REGISTRY = {
    "0.68.0-Unofficial": "minaclac-68.0-unofficial",
    "0.70.0": "minaclac-70.0",
    "0.72.0": "minaclac-72.0",
    "0.72.3": "minaclac-72.3",
    "0.74.0": "minaclac-74.0",
};
const DEFAULT_VERSION = "0.72.3";
const DISPLAY_SKILLSET_ORDER = [
    "Overall", "Stream", "Jumpstream", "Handstream",
    "Stamina", "JackSpeed", "Chordjack", "Technical",
];

function normalizeVersion(v) {
    const s = typeof v === "string" ? v.trim() : "";
    return s === "0.68.0" ? "0.68.0-Unofficial" : (s || DEFAULT_VERSION);
}

function resolveKeycount(parsed, override) {
    const supported = new Set([4, 6, 7]);
    if (Number.isFinite(override) && supported.has(override)) return override;
    if (supported.has(parsed)) return parsed;
    throw new Error(`Unsupported keycount: ${parsed}`);
}

function applyMod(chart, cvtFlag) {
    const n = String(cvtFlag || "").toUpperCase();
    if (n.includes("IN")) chart.modIN();
    if (n.includes("HO")) chart.modHO();
}

function buildRows(chart) {
    const byTime = new Map();
    const cols = chart.columns || [];
    const starts = chart.noteStarts || [];
    const len = Math.min(cols.length, starts.length);
    for (let i = 0; i < len; i++) {
        const c = Number(cols[i]);
        const t = Math.trunc(Number(starts[i]));
        if (!Number.isFinite(c) || !Number.isFinite(t) || c < 0 || c > 31) continue;
        byTime.set(t, (byTime.get(t) || 0) | (1 << c));
    }
    const times = [...byTime.keys()].sort((a, b) => a - b);
    const masks = new Uint32Array(times.length);
    const seconds = new Float32Array(times.length);
    for (let i = 0; i < times.length; i++) {
        masks[i] = byTime.get(times[i]) >>> 0;
        seconds[i] = times[i] / 1000;
    }
    return { masks, seconds };
}

function makeZeroValues() {
    const out = {};
    for (const n of DISPLAY_SKILLSET_ORDER) out[n] = 0;
    return out;
}

function sanitize(values) {
    const input = values && typeof values === "object" ? values : {};
    const out = {};
    for (const n of DISPLAY_SKILLSET_ORDER) {
        out[n] = Number.isFinite(Number(input[n])) ? Number(input[n]) : 0;
    }
    return out;
}

async function loadEtternaModule(version) {
    const normalized = normalizeVersion(version);
    const name = ETTERNA_VERSION_REGISTRY[normalized];
    if (!name) throw new Error(`Unknown Etterna version: ${version}`);

    const apiSrcDir = dirname(fileURLToPath(import.meta.url));
    const projectRoot = dirname(dirname(apiSrcDir));
    const wasmPath = resolve(projectRoot, "ManiaMapAnalyser by Leo_Black/js/ett/versions", `${name}.wasm`);
    const wasmBytes = readFileSync(wasmPath);

    const mem = new WebAssembly.Memory({ initial: 256 });

    const fullImports = {
        a: {
            memory: mem,
            a: () => {},
            b: () => 0,
            c: () => BigInt(0),
            d: () => {},
            e: () => 0,
            f: () => 0,
            g: () => 0,
            h: () => 0,
            i: () => 0,
            j: () => 0,
            k: () => 0,
            l: () => 0,
        },
        b: { memory: mem },
        c: { d: mem },
        d: { e: mem },
        e: { f: mem },
        f: { g: mem },
        g: { h: mem },
        h: { i: mem },
        i: { j: mem },
        j: { k: mem },
    };

    const result = await WebAssembly.instantiate(wasmBytes, fullImports);
    return result.instance.exports;
}

async function runCalc(module, { keycount, musicRate, scoreGoal, rowMasks, rowTimes }) {
    const mem = module.m;
    const u32 = new Uint32Array(mem.buffer);
    const f32 = new Float32Array(mem.buffer);

    const MASK_PTR = 1024;
    const TIME_PTR = MASK_PTR + rowMasks.length * 4;
    const OUT_PTR = TIME_PTR + rowTimes.length * 4;

    u32.set(rowMasks, MASK_PTR >>> 2);
    f32.set(rowTimes, TIME_PTR >>> 2);

    const ok = module.o(
        keycount, Number(musicRate), Number(scoreGoal),
        MASK_PTR, TIME_PTR, rowMasks.length, OUT_PTR,
    );

    if (!ok) throw new Error("minacalc_compute returned failure");

    const OFFICIAL_OUTPUT_ORDER = ["Overall", "Stream", "Jumpstream", "Handstream", "Stamina", "JackSpeed", "Chordjack", "Technical"];
    const raw = f32.slice(OUT_PTR >>> 2, (OUT_PTR >>> 2) + OFFICIAL_OUTPUT_ORDER.length);

    const out = {};
    for (let i = 0; i < OFFICIAL_OUTPUT_ORDER.length; i++) {
        out[OFFICIAL_OUTPUT_ORDER[i]] = Number(raw[i]) || 0;
    }
    return out;
}

export async function analyzeEtternaFromText(osuText, {
    musicRate = 1.0,
    scoreGoal = 0.93,
    keyOverride = null,
    cvtFlag = null,
    etternaVersion = DEFAULT_VERSION,
} = {}) {
    const apiSrcDir = dirname(fileURLToPath(import.meta.url));
    const projectRoot = dirname(dirname(apiSrcDir));
    const parserPath = resolve(projectRoot, "ManiaMapAnalyser by Leo_Black/js/parser/osuFileParser.js");
    const { OsuFileParser } = await import(pathToFileURL(parserPath));
    const chart = new OsuFileParser(osuText);
    chart.process();
    if (chart.status !== "OK") throw new Error(`Beatmap parse status: ${chart.status}`);

    const keycount = resolveKeycount(chart.columnCount, keyOverride);
    applyMod(chart, cvtFlag);

    const { masks, seconds } = buildRows(chart);
    if (masks.length <= 1) return { keycount, lnRatio: chart.lnRatio, metadata: chart.metaData, values: makeZeroValues() };

    const wasmModule = await loadEtternaModule(etternaVersion);
    const values = await runCalc(wasmModule, { keycount, musicRate, scoreGoal, rowMasks: masks, rowTimes: seconds });

    return {
        keycount,
        lnRatio: chart.lnRatio,
        metadata: chart.metaData,
        requestedEtternaVersion: etternaVersion,
        etternaVersion: normalizeVersion(etternaVersion),
        values: sanitize(values),
    };
}

export { DEFAULT_VERSION as DEFAULT_ETTERNA_VERSION, DISPLAY_SKILLSET_ORDER };