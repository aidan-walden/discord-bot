export function isAdminUser(
	userId: string,
	adminUserIds: ReadonlySet<string>,
): boolean {
	return adminUserIds.has(userId);
}
