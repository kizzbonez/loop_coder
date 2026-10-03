export const now = (): Date => new Date();

export const addMinutes = (date: Date, minutes: number): Date => new Date(date.getTime() + minutes * 60_000);
export const addHours = (date: Date, hours: number): Date => addMinutes(date, hours * 60);
export const addDays = (date: Date, days: number): Date => addHours(date, days * 24);

export const iso = (date: Date): string => date.toISOString();
export const isoOrNull = (date: Date | null | undefined): string | null => (date ? date.toISOString() : null);
