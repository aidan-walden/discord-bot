export function getNthWeekdayOfMonth(
	year: number,
	month: number,
	weekday: number,
	n: number,
) {
	const first = new Date(year, month, 1);
	const offset = (weekday - first.getDay() + 7) % 7;
	return new Date(year, month, 1 + offset + (n - 1) * 7);
}

export function getEod(year: number, month: number, day: number) {
	return new Date(year, month, day, 23, 59, 59, 999);
}
