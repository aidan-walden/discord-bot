import path from "node:path";
import { crc32 } from "node:zlib";
import { codeBlock } from "discord.js";
import type {
	CounterStrikeCaseCatalog,
	CounterStrikeCaseDefinition,
	CounterStrikeSkin,
	CounterStrikeSkinsFile,
	ScrapedSkin,
	SkinRarity,
} from "../models/CounterStrikeSkin";

const ASSET_PATH = path.resolve(import.meta.dirname, "../../assets/skins.json");
const RARITY_ORDER: SkinRarity[] = ["Blue", "Purple", "Pink", "Red", "Gold"];
type RollRarityKey = Exclude<keyof CounterStrikeCaseDefinition, "price">;

let cachedFile: CounterStrikeSkinsFile | null = null;

export function clearCaseCatalogCache(): void {
	cachedFile = null;
}

export interface UnboxRunResult {
	caseName: string;
	finalSkin: CounterStrikeSkin;
	displayName: string;
	rolls: number;
	spentCases: number;
	spentKeys: number;
	totalSpent: number;
	totalGained: number;
	profit: number;
	profitCents: number;
	paintSeed: number;
	scrapedAt: number;
	countsByRarity: Record<SkinRarity, number>;
	rolledSkins: Record<SkinRarity, Record<string, number>>;
}

interface PreviewData {
	defIndex: number;
	paintIndex: number;
	rarity: number;
	wear: number;
	paintSeed: number;
	stattrak?: boolean;
}

function encodeVarint(value: number): number[] {
	const bytes: number[] = [];
	while (value > 0x7f) {
		bytes.push((value % 0x80) | 0x80);
		value = Math.floor(value / 0x80);
	}
	bytes.push(value);
	return bytes;
}

function encodeUint32Field(field: number, value: number): number[] {
	return [...encodeVarint(field << 3), ...encodeVarint(value >>> 0)];
}

export function createPreviewHex(data: PreviewData): string {
	const floatBuffer = new ArrayBuffer(4);
	const floatView = new DataView(floatBuffer);
	floatView.setFloat32(0, data.wear, true);

	const protobuf = [
		...encodeUint32Field(3, data.defIndex),
		...encodeUint32Field(4, data.paintIndex),
		...encodeUint32Field(5, data.rarity),
		...(data.stattrak ? encodeUint32Field(6, 9) : []),
		...encodeUint32Field(7, floatView.getUint32(0, true)),
		...encodeUint32Field(8, data.paintSeed),
		...(data.stattrak ? encodeUint32Field(9, 0) : []),
		...(data.stattrak ? encodeUint32Field(10, 0) : []),
	];
	const payload = Uint8Array.from([0, ...protobuf]);
	const crc = crc32(payload);
	const checksumValue = ((crc & 0xffff) ^ (protobuf.length * crc)) >>> 0;
	const checksum = new Uint8Array(4);
	new DataView(checksum.buffer).setUint32(0, checksumValue);

	return Buffer.from([...payload, ...checksum])
		.toString("hex")
		.toUpperCase();
}

export function createInGameInspectUrl(
	skin: CounterStrikeSkin,
	paintSeed: number,
): string | null {
	if (skin.defIndex === undefined || skin.paintIndex === undefined) {
		return null;
	}

	const preview = createPreviewHex({
		defIndex: skin.defIndex,
		paintIndex: skin.paintIndex,
		rarity: 6,
		wear: skin.floatValue ?? 0,
		paintSeed,
		stattrak: skin.stattrak,
	});
	const steamUrl = `steam://rungame/730/76561202255233023/+csgo_econ_action_preview ${preview}`;
	const url = new URL("https://cs2inspects.com/");
	url.searchParams.set("apply", steamUrl);
	return url.toString();
}

export function formatCurrency(
	num: number,
	currencyCode = "USD",
	locale = "en-US",
): string {
	return new Intl.NumberFormat(locale, {
		style: "currency",
		currency: currencyCode,
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(num);
}

export function roundHalfToEven(num: number, decimalPlaces: number): number {
	const multiplier = 10 ** decimalPlaces;
	const adjustedNum = num * multiplier;
	const roundedNum = Math.round(adjustedNum);

	if (Math.abs(adjustedNum - roundedNum) === 0.5 && roundedNum % 2 !== 0) {
		return (roundedNum - 1) / multiplier;
	}

	return roundedNum / multiplier;
}

export function getWear(floatValue: number | null): string | null {
	if (floatValue === null) {
		return "Vanilla";
	}

	if (floatValue < 0 || floatValue > 1) {
		return null;
	}

	if (floatValue <= 0.07) {
		return "Factory New";
	}

	if (floatValue <= 0.15) {
		return "Minimal Wear";
	}

	if (floatValue <= 0.38) {
		return "Field-Tested";
	}

	if (floatValue <= 0.45) {
		return "Well-Worn";
	}

	return "Battle-Scarred";
}

export function downgradeWear(floatValue: number, rng = Math.random): number {
	if (floatValue <= 0.07) {
		return rng() * (0.15 - 0.08) + 0.08;
	}

	if (floatValue <= 0.15) {
		return rng() * (0.38 - 0.16) + 0.16;
	}

	if (floatValue <= 0.38) {
		return rng() * (0.45 - 0.39) + 0.39;
	}

	if (floatValue <= 0.45) {
		return rng() * (1.0 - 0.46) + 0.46;
	}

	return rng() * 0.07;
}

export function rollRarity(rng = Math.random): RollRarityKey {
	const rarityRoll = rng();

	if (rarityRoll >= 0.9974) {
		return "gold";
	}

	if (rarityRoll >= 0.9936) {
		return "red";
	}

	if (rarityRoll >= 0.9616) {
		return "pink";
	}

	if (rarityRoll >= 0.8018) {
		return "purple";
	}

	return "blue";
}

export function getRarityColor(rarity: SkinRarity): number {
	switch (rarity) {
		case "Red":
			return 0xd95752;
		case "Pink":
			return 0xc23ede;
		case "Purple":
			return 0x7f4af6;
		case "Blue":
			return 0x5168f6;
		case "Gold":
			return 0xf9d849;
	}
}

function parseSkinsFile(parsed: unknown): CounterStrikeSkinsFile {
	if (Array.isArray(parsed) || typeof parsed !== "object" || parsed === null) {
		throw new Error("Invalid skins.json: expected an object at root.");
	}
	const root = parsed as Record<string, unknown>;
	if (
		typeof root.scrapedAt !== "number" ||
		!Number.isFinite(root.scrapedAt) ||
		Array.isArray(root.cases) ||
		typeof root.cases !== "object" ||
		root.cases === null
	) {
		throw new Error(
			"Invalid skins.json: expected { scrapedAt: number, cases: object }.",
		);
	}
	return {
		scrapedAt: root.scrapedAt,
		cases: root.cases as CounterStrikeCaseCatalog,
	};
}

async function loadSkinsFile(): Promise<CounterStrikeSkinsFile> {
	if (cachedFile) {
		return cachedFile;
	}

	const fileContents = await Bun.file(ASSET_PATH).text();
	cachedFile = parseSkinsFile(JSON.parse(fileContents) as unknown);
	return cachedFile;
}

export async function isUnboxCatalogAvailable(): Promise<boolean> {
	try {
		await loadSkinsFile();
		return true;
	} catch {
		return false;
	}
}

export async function loadCaseCatalog(): Promise<CounterStrikeCaseCatalog> {
	const file = await loadSkinsFile();
	return file.cases;
}

export async function listCaseNames(): Promise<string[]> {
	const catalog = await loadCaseCatalog();
	return Object.keys(catalog).sort((left, right) => left.localeCompare(right));
}

function buildEmptyRarityMap(): Record<SkinRarity, Record<string, number>> {
	return {
		Blue: {},
		Purple: {},
		Pink: {},
		Red: {},
		Gold: {},
	};
}

function buildEmptyRarityCounts(): Record<SkinRarity, number> {
	return {
		Blue: 0,
		Purple: 0,
		Pink: 0,
		Red: 0,
		Gold: 0,
	};
}

function getDisplayName(skin: CounterStrikeSkin): string {
	return skin.stattrak ? `StatTrak(R) ${skin.name}` : skin.name;
}

function chooseRandomSkin(
	caseDefinition: CounterStrikeCaseDefinition,
	rarityKey: RollRarityKey,
	rng = Math.random,
): ScrapedSkin {
	const skins = caseDefinition[rarityKey];
	const index = Math.floor(rng() * skins.length);
	const selectedSkin = skins[index];
	if (!selectedSkin) {
		throw new Error(`No skin found for rarity ${rarityKey}.`);
	}

	return selectedSkin;
}

function resolveSkin(
	skin: ScrapedSkin,
	rng = Math.random,
): CounterStrikeSkin | null {
	const stattrak = skin.stattrak && rng() <= 0.1;
	let floatValue =
		skin.maxWear === null || skin.minWear === null
			? null
			: rng() * (skin.maxWear - skin.minWear) + skin.minWear;
	let price: number | null | undefined;
	let wear = getWear(floatValue);
	let retries = 0;

	while (wear && retries < 6) {
		price = stattrak ? skin.pricing[`StatTrak ${wear}`] : skin.pricing[wear];
		if (price !== null && price !== undefined) {
			return {
				name: skin.name,
				stattrak,
				floatValue,
				wear,
				price,
				rarity: skin.rarity,
				imageUrl: skin.img,
				defIndex: skin.defIndex,
				paintIndex: skin.paintIndex,
			};
		}

		if (floatValue === null) {
			break;
		}

		floatValue = downgradeWear(floatValue, rng);
		wear = getWear(floatValue);
		retries++;
	}

	return null;
}

export async function runUnboxSimulation(
	caseName: string | null,
	rng = Math.random,
): Promise<UnboxRunResult> {
	const file = await loadSkinsFile();
	const catalog = file.cases;
	const availableCaseNames = Object.keys(catalog);
	const selectedCaseName =
		caseName ??
		availableCaseNames[Math.floor(rng() * availableCaseNames.length)] ??
		null;

	if (!selectedCaseName) {
		throw new Error("No cases are available in the catalog.");
	}

	const caseDefinition = catalog[selectedCaseName];
	if (!caseDefinition) {
		throw new Error(`Unknown case: ${selectedCaseName}`);
	}

	const rolledSkins = buildEmptyRarityMap();
	const countsByRarity = buildEmptyRarityCounts();
	let totalGained = 0;
	let rolls = 0;

	for (;;) {
		const rarityKey = rollRarity(rng);
		const rolledSkin = chooseRandomSkin(caseDefinition, rarityKey, rng);
		const resolvedSkin = resolveSkin(rolledSkin, rng);
		if (!resolvedSkin) {
			continue;
		}

		rolls++;
		const displayName = getDisplayName(resolvedSkin);
		totalGained += resolvedSkin.price;
		countsByRarity[resolvedSkin.rarity]++;
		rolledSkins[resolvedSkin.rarity][displayName] =
			(rolledSkins[resolvedSkin.rarity][displayName] ?? 0) + 1;

		if (rarityKey !== "gold") {
			continue;
		}

		const spentCases = rolls * caseDefinition.price;
		const spentKeys = rolls * 2.5;
		const totalSpent = spentCases + spentKeys;
		const profit = roundHalfToEven(totalGained - totalSpent, 2);
		const profitCents = Math.round(profit * 100);
		const paintSeed = Math.floor(rng() * 1000) + 1;

		return {
			caseName: selectedCaseName,
			finalSkin: resolvedSkin,
			displayName,
			rolls,
			spentCases,
			spentKeys,
			totalSpent,
			totalGained,
			profit,
			profitCents,
			paintSeed,
			scrapedAt: file.scrapedAt,
			countsByRarity,
			rolledSkins,
		};
	}
}

export function formatRolledSkinsSummary(
	rolledSkins: Record<SkinRarity, Record<string, number>>,
): string {
	const sections = RARITY_ORDER.map((rarity) => {
		const entries = Object.entries(rolledSkins[rarity]).sort(
			([leftName, leftCount], [rightName, rightCount]) =>
				rightCount - leftCount || leftName.localeCompare(rightName),
		);
		const lines =
			entries.length === 0
				? ["\tNone"]
				: entries.map(([name, count]) => `\t${count}x ${name}`);
		return `${rarity}s:\n${lines.join("\n")}`;
	});

	return codeBlock(sections.join("\n"));
}
