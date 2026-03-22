export type SkinRarity = "Blue" | "Purple" | "Pink" | "Red" | "Gold";

export interface CounterStrikeSkin {
	name: string;
	stattrak: boolean;
	floatValue: number | null;
	wear: string;
	price: number;
	rarity: SkinRarity;
	imageUrl: string;
}

export interface ScrapedSkin {
	name: string;
	img: string;
	rarity: SkinRarity;
	stattrak: boolean;
	pricing: Record<string, number | null>;
	minWear: number | null;
	maxWear: number | null;
}

export interface CounterStrikeCaseDefinition {
	price: number;
	blue: ScrapedSkin[];
	purple: ScrapedSkin[];
	pink: ScrapedSkin[];
	red: ScrapedSkin[];
	gold: ScrapedSkin[];
}

export type CounterStrikeCaseCatalog = Record<
	string,
	CounterStrikeCaseDefinition
>;
