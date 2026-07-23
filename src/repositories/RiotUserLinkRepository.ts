import type { RiotPlatform } from "../services/riot/constants";

export interface RiotUserLink {
	userId: string;
	puuid: string;
	platform: RiotPlatform;
	gameName: string;
	tagLine: string;
	linkedAt: Date;
}

interface RiotUserLinkRow {
	user_id: string;
	puuid: string;
	platform: string;
	game_name: string;
	tag_line: string;
	linked_at: Date;
}

function mapRow(row: RiotUserLinkRow): RiotUserLink {
	return {
		userId: row.user_id,
		puuid: row.puuid,
		platform: row.platform as RiotPlatform,
		gameName: row.game_name,
		tagLine: row.tag_line,
		linkedAt: row.linked_at,
	};
}

export default class RiotUserLinkRepository {
	constructor(private readonly sql: typeof Bun.sql) {}

	/** Newest linked account (primary for /lol view stats). */
	async getPrimaryByUserId(userId: string): Promise<RiotUserLink | null> {
		const rows = await this.sql<RiotUserLinkRow[]>`
			SELECT user_id, puuid, platform, game_name, tag_line, linked_at
			FROM riot_user_links
			WHERE user_id = ${userId}
			ORDER BY linked_at DESC
			LIMIT 1
		`;
		const row = rows[0];
		return row ? mapRow(row) : null;
	}

	/** @deprecated use getPrimaryByUserId — kept as alias */
	async getByUserId(userId: string): Promise<RiotUserLink | null> {
		return this.getPrimaryByUserId(userId);
	}

	async listByUserId(userId: string): Promise<RiotUserLink[]> {
		const rows = await this.sql<RiotUserLinkRow[]>`
			SELECT user_id, puuid, platform, game_name, tag_line, linked_at
			FROM riot_user_links
			WHERE user_id = ${userId}
			ORDER BY linked_at DESC
		`;
		return rows.map(mapRow);
	}

	async upsert(link: {
		userId: string;
		puuid: string;
		platform: RiotPlatform;
		gameName: string;
		tagLine: string;
	}): Promise<RiotUserLink> {
		const rows = await this.sql<RiotUserLinkRow[]>`
			INSERT INTO riot_user_links (puuid, user_id, platform, game_name, tag_line)
			VALUES (
				${link.puuid},
				${link.userId},
				${link.platform},
				${link.gameName},
				${link.tagLine}
			)
			ON CONFLICT (puuid) DO UPDATE SET
				user_id = EXCLUDED.user_id,
				platform = EXCLUDED.platform,
				game_name = EXCLUDED.game_name,
				tag_line = EXCLUDED.tag_line,
				linked_at = NOW()
			RETURNING user_id, puuid, platform, game_name, tag_line, linked_at
		`;
		const row = rows[0];
		if (!row) {
			throw new Error("Failed to upsert riot user link");
		}
		return mapRow(row);
	}
}
