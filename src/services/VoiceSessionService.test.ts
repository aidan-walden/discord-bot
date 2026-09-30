import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { DiscordGatewayAdapterCreator } from "@discordjs/voice";
import type { Client } from "discord.js";
import type { Kazagumo } from "kazagumo";
import VoiceSessionService, {
	VoiceBusyError,
	type VoiceSessionDeps,
} from "./VoiceSessionService";

const IDLE_MS = 50;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function createFakeKazagumo() {
	const emitter = new EventEmitter();
	const players = new Map<string, FakePlayer>();
	const shoukaku = new EventEmitter() as EventEmitter & {
		players: Map<string, unknown>;
	};
	shoukaku.players = new Map();
	const kazagumo = Object.assign(emitter, {
		players,
		shoukaku,
		getPlayer: (guildId: string) => players.get(guildId),
		destroyPlayer: mock(() => undefined),
		createPlayer: mock(async (o: { guildId: string; voiceId: string }) => {
			const existing = players.get(o.guildId);
			if (existing) return existing;
			const player: FakePlayer = {
				guildId: o.guildId,
				voiceId: o.voiceId,
				destroy: mock(async () => {
					players.delete(o.guildId);
					emitter.emit("playerDestroy", player);
				}),
			};
			players.set(o.guildId, player);
			return player;
		}),
	});
	return kazagumo;
}
type FakePlayer = {
	guildId: string;
	voiceId: string;
	destroy: ReturnType<typeof mock>;
};

function createFakeConnection(channelId = "voice-1") {
	return {
		joinConfig: { channelId },
		subscribe: mock(() => ({})),
		destroy: mock(() => undefined),
	};
}

function createFakeAudioPlayer() {
	const player = Object.assign(new EventEmitter(), {
		play: mock(() => undefined),
		stop: mock(() => true),
	});
	return player;
}

function setup() {
	const kazagumo = createFakeKazagumo();
	const connections = new Map<
		string,
		ReturnType<typeof createFakeConnection>
	>();
	const audioPlayers: ReturnType<typeof createFakeAudioPlayer>[] = [];
	const deps = {
		createKazagumo: () => kazagumo as unknown as Kazagumo,
		joinVoiceChannel: mock((o: { guildId: string; channelId: string }) => {
			const c = createFakeConnection(o.channelId);
			connections.set(o.guildId, c);
			return c;
		}),
		createAudioPlayer: mock(() => {
			const p = createFakeAudioPlayer();
			audioPlayers.push(p);
			return p;
		}),
		createAudioResource: mock(() => ({})),
		entersState: mock(async (target: unknown) => target),
		getVoiceConnection: mock((guildId: string) => connections.get(guildId)),
		idleLeaveMs: IDLE_MS,
	};
	const service = new VoiceSessionService(
		{} as Client,
		[],
		deps as unknown as Partial<VoiceSessionDeps>,
	);
	const playTts = (guildId = "g1", extra: { durationSeconds?: number } = {}) =>
		service.playTts({
			guildId,
			channelId: "voice-1",
			adapterCreator: {} as DiscordGatewayAdapterCreator,
			oggPath: "/tmp/x.ogg",
			durationSeconds: extra.durationSeconds ?? 1,
		});
	return { service, kazagumo, connections, audioPlayers, deps, playTts };
}

let logSpy: ReturnType<typeof mock>;
beforeEach(() => {
	logSpy = mock(() => undefined);
});
afterEach(() => {
	logSpy.mockRestore?.();
});

describe("VoiceSessionService", () => {
	test("startMusic releases an active TTS session and creates a deaf player", async () => {
		const { service, kazagumo, connections, audioPlayers, playTts } = setup();
		await playTts();
		expect(service.getOwner("g1")).toBe("tts");

		const player = await service.startMusic({
			guildId: "g1",
			textId: "t",
			voiceId: "v",
		});

		expect(audioPlayers[0]?.stop).toHaveBeenCalledWith(true);
		expect(connections.get("g1")?.destroy).toHaveBeenCalledTimes(1);
		expect(kazagumo.createPlayer).toHaveBeenCalledWith({
			guildId: "g1",
			textId: "t",
			voiceId: "v",
			deaf: true,
		});
		expect(service.getOwner("g1")).toBe("music");
		expect(service.getMusicPlayer("g1")).toBe(player);
	});

	test("playTts throws VoiceBusyError while music is active", async () => {
		const { service, playTts, deps } = setup();
		await service.startMusic({ guildId: "g1", textId: "t", voiceId: "v" });

		await expect(playTts()).rejects.toBeInstanceOf(VoiceBusyError);
		expect(service.isMusicActive("g1")).toBe(true);
		expect(deps.joinVoiceChannel).not.toHaveBeenCalled();
	});

	test("playTts plays, reports playing, and leaves after the idle timeout", async () => {
		const { service, connections, playTts } = setup();
		const onPlaying = mock(async () => undefined);
		await service.playTts({
			guildId: "g1",
			channelId: "voice-1",
			adapterCreator: {} as DiscordGatewayAdapterCreator,
			oggPath: "/tmp/x.ogg",
			durationSeconds: 1,
			onPlaying,
		});
		expect(onPlaying).toHaveBeenCalledTimes(1);
		expect(service.getVoiceChannelId("g1")).toBe("voice-1");
		expect(connections.get("g1")?.destroy).not.toHaveBeenCalled();

		await wait(IDLE_MS * 3);

		expect(connections.get("g1")?.destroy).toHaveBeenCalledTimes(1);
		expect(service.getOwner("g1")).toBe("none");
		void playTts;
	});

	test("a newer TTS request supersedes the older one and cancels its idle timer", async () => {
		const { service, connections, audioPlayers, playTts } = setup();
		await playTts();
		const first = connections.get("g1");
		await playTts();
		const second = connections.get("g1");
		expect(first).not.toBe(second);
		expect(audioPlayers[0]?.stop).toHaveBeenCalledWith(true);

		await wait(IDLE_MS * 3);

		// Only the newest session's timer fires.
		expect(second?.destroy).toHaveBeenCalledTimes(1);
		expect(service.getOwner("g1")).toBe("none");
	});

	test("idle timer is shared: playerEmpty destroys the music player, playerStart cancels it", async () => {
		const { service, kazagumo } = setup();
		const player = (await service.startMusic({
			guildId: "g1",
			textId: "t",
			voiceId: "v",
		})) as unknown as FakePlayer;

		kazagumo.emit("playerEmpty", player);
		kazagumo.emit("playerStart", player);
		await wait(IDLE_MS * 3);
		expect(player.destroy).not.toHaveBeenCalled();

		kazagumo.emit("playerEmpty", player);
		await wait(IDLE_MS * 3);
		expect(player.destroy).toHaveBeenCalledTimes(1);
		expect(service.getOwner("g1")).toBe("none");
	});

	test("playerDestroy clears a pending idle leave", async () => {
		const { service, kazagumo } = setup();
		const player = (await service.startMusic({
			guildId: "g1",
			textId: "t",
			voiceId: "v",
		})) as unknown as FakePlayer;
		kazagumo.emit("playerEmpty", player);
		kazagumo.emit("playerDestroy", player);
		await wait(IDLE_MS * 3);
		expect(player.destroy).not.toHaveBeenCalled();
	});

	test("leave destroys the music player", async () => {
		const { service } = setup();
		const player = (await service.startMusic({
			guildId: "g1",
			textId: "t",
			voiceId: "v",
		})) as unknown as FakePlayer;

		await service.leave("g1");

		expect(player.destroy).toHaveBeenCalledTimes(1);
		expect(service.getOwner("g1")).toBe("none");
	});

	test("leave stops TTS, destroys its connection, and clears the idle timer", async () => {
		const { service, connections, audioPlayers, playTts } = setup();
		await playTts();

		await service.leave("g1");

		expect(audioPlayers[0]?.stop).toHaveBeenCalledWith(true);
		expect(connections.get("g1")?.destroy).toHaveBeenCalledTimes(1);
		expect(service.getOwner("g1")).toBe("none");

		await wait(IDLE_MS * 3);
		expect(connections.get("g1")?.destroy).toHaveBeenCalledTimes(1);
	});

	test("leave is a no-op when nothing owns the guild", async () => {
		const { service, deps } = setup();
		await service.leave("g1");
		expect(deps.getVoiceConnection).toHaveBeenCalledTimes(1);
		expect(service.getOwner("g1")).toBe("none");
	});

	test("playTts tears down and rethrows when the player errors", async () => {
		const { service, connections, audioPlayers, deps, playTts } = setup();
		deps.entersState.mockImplementation(async (target: unknown) => {
			if (audioPlayers.includes(target as never)) {
				(target as EventEmitter).emit("error", new Error("boom"));
				await wait(1_000);
			}
			return target;
		});

		await expect(playTts()).rejects.toThrow("boom");
		expect(connections.get("g1")?.destroy).toHaveBeenCalledTimes(1);
		expect(service.getOwner("g1")).toBe("none");
	});
});
