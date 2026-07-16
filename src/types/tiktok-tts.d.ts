declare module "tiktok-tts" {
	export function config(tiktokSessionId: string, customBaseUrl?: string): void;
	export function createAudioFromText(
		text: string,
		fileName?: string,
		speaker?: string,
	): Promise<void>;
}
