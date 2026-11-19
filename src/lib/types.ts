export type Priority = 'max' | 'high' | 'medium' | 'low';
export type JobStatus = 'to_schedule' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export const PRIORITIES: Priority[] = ['max', 'high', 'medium', 'low'];
export const PRIORITY_LABEL: Record<Priority, string> = { max: 'Massima', high: 'Alta', medium: 'Media', low: 'Bassa' };
export const PRIORITY_COLOR: Record<Priority, string> = { max: '#ea580c', high: '#d97706', medium: '#2563eb', low: '#6b7280' };
export interface Template {
  id: string; name: string; description: string | null; pieces_per_plate: number; duration_minutes: number;
  repetitions: number; priority: Priority; color: string; notes: string | null; divisible: boolean;
  preview_url: string | null; archived_at: string | null; created_at: string; version: number;
}
export type TemplateDraft = Omit<Template, 'id' | 'created_at' | 'archived_at' | 'version'>;
export interface JobLite { id: string; template_id: string | null; status: JobStatus }
export const fmtDuration = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
export const STATUS_LABEL: Record<JobStatus, string> = {
  to_schedule: 'Da programmare', scheduled: 'Programmata', in_progress: 'In corso', completed: 'Completata', cancelled: 'Annullata' };
