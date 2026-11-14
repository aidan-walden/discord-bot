/** True for TypeScript source modules that should be loaded at runtime (not tests). */
export function isRuntimeTypescriptModule(file: string): boolean {
	return file.endsWith(".ts") && !file.endsWith(".test.ts");
}
