import { handleRoot } from "./routes/index";

const PORT = 3000;

export function startWebServer(): void {
	Bun.serve({
		port: PORT,
		fetch(req) {
			const url = new URL(req.url);

			if (url.pathname === "/") return handleRoot(req);

			return new Response("Not Found", { status: 404 });
		},
	});

	console.log(`Admin web UI listening on http://localhost:${PORT}`);
}
