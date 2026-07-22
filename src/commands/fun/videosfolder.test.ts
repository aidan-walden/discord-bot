import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import VideosFolder, { loadVideos, MAX_VIDEO_BYTES } from "./videosfolder";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(path.join(os.tmpdir(), "videosfolder-test-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) await rm(dir, { recursive: true, force: true });
	}
});

describe("loadVideos", () => {
	test("warns and returns empty when directory is missing", () => {
		const warn = spyOn(console, "warn").mockImplementation(() => undefined);
		try {
			const missing = path.join(
				os.tmpdir(),
				`videosfolder-missing-${Date.now()}`,
			);
			expect(loadVideos(missing)).toEqual([]);
			expect(warn).toHaveBeenCalledWith(
				`videosfolder: directory missing or not a dir: ${missing}`,
			);
		} finally {
			warn.mockRestore();
		}
	});

	test("keeps small videos", async () => {
		const dir = await makeTempDir();
		await Bun.write(path.join(dir, "ok.mp4"), "tiny");
		const warn = spyOn(console, "warn").mockImplementation(() => undefined);
		try {
			expect(loadVideos(dir)).toEqual(["ok.mp4"]);
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	test("excludes videos over MAX_VIDEO_BYTES and warns", async () => {
		const dir = await makeTempDir();
		await Bun.write(
			path.join(dir, "big.mp4"),
			Buffer.alloc(MAX_VIDEO_BYTES + 1),
		);
		const warn = spyOn(console, "warn").mockImplementation(() => undefined);
		try {
			expect(loadVideos(dir)).toEqual([]);
			expect(warn).toHaveBeenCalledWith(
				`videosfolder: excluding big.mp4 (${MAX_VIDEO_BYTES + 1} bytes > ${MAX_VIDEO_BYTES})`,
			);
			expect(warn).toHaveBeenCalledWith(
				"videosfolder: no uploadable videos after size filter",
			);
		} finally {
			warn.mockRestore();
		}
	});

	test("skips non-video extensions", async () => {
		const dir = await makeTempDir();
		await Bun.write(path.join(dir, "notes.txt"), "nope");
		const warn = spyOn(console, "warn").mockImplementation(() => undefined);
		try {
			expect(loadVideos(dir)).toEqual([]);
			expect(warn).toHaveBeenCalledWith(
				"videosfolder: no uploadable videos after size filter",
			);
		} finally {
			warn.mockRestore();
		}
	});

	test("mixed folder keeps only eligible videos", async () => {
		const dir = await makeTempDir();
		await Bun.write(path.join(dir, "keep.webm"), "ok");
		await Bun.write(
			path.join(dir, "drop.mp4"),
			Buffer.alloc(MAX_VIDEO_BYTES + 1),
		);
		await Bun.write(path.join(dir, "notes.txt"), "nope");
		const warn = spyOn(console, "warn").mockImplementation(() => undefined);
		try {
			expect(loadVideos(dir)).toEqual(["keep.webm"]);
			expect(warn).toHaveBeenCalledWith(
				`videosfolder: excluding drop.mp4 (${MAX_VIDEO_BYTES + 1} bytes > ${MAX_VIDEO_BYTES})`,
			);
			expect(warn).toHaveBeenCalledTimes(1);
		} finally {
			warn.mockRestore();
		}
	});
});

describe("VideosFolder.execute", () => {
	function interaction() {
		const reply = mock(async () => undefined);
		return {
			reply,
			interaction: { reply } as unknown as ChatInputCommandInteraction,
		};
	}

	test("replies ephemerally when no videos", async () => {
		const { reply, interaction: i } = interaction();
		await new VideosFolder([]).execute(i);
		expect(reply).toHaveBeenCalledWith({
			content: "No videos found.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("replies with a random eligible video file", async () => {
		const { reply, interaction: i } = interaction();
		await new VideosFolder(["clip.mp4"], "/tmp/vids").execute(i);
		expect(reply).toHaveBeenCalledWith({
			files: [path.join("/tmp/vids", "clip.mp4")],
		});
	});
});
