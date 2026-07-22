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

	async getByUserId(userId: string): Promise<RiotUserLink | null> {
		const rows = await this.sql<RiotUserLinkRow[]>`
			SELECT user_id, puuid, platform, game_name, tag_line, linked_at
			FROM riot_user_links
			WHERE user_id = ${userId}
		`;
		const row = rows[0];
		return row ? mapRow(row) : null;
	}

	async upsert(link: {
		userId: string;
		puuid: string;
		platform: RiotPlatform;
		gameName: string;
		tagLine: string;
	}): Promise<RiotUserLink> {
		const rows = await this.sql<RiotUserLinkRow[]>`
			INSERT INTO riot_user_links (user_id, puuid, platform, game_name, tag_line)
			VALUES (
				${link.userId},
				${link.puuid},
				${link.platform},
				${link.gameName},
				${link.tagLine}
			)
			ON CONFLICT (user_id) DO UPDATE SET
				puuid = EXCLUDED.puuid,
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
