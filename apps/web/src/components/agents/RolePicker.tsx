import { useId } from 'react';
import { useRoles } from '../../lib/queries';

/**
 * Which roles an agent plays: every role (one agent does everything) or a chosen set, so several
 * agents can work side by side, for example one that builds and one that reviews and tests.
 * `null` means every role; an empty list is not a valid choice.
 */
export function RolePicker({ value, onChange }: { value: string[] | null; onChange: (value: string[] | null) => void }) {
  const roles = useRoles();
  const name = useId();
  const list = (roles.data ?? []).filter((r) => r.enabled);
  const toggle = (key: string, on: boolean) => onChange(on ? [...(value ?? []), key] : (value ?? []).filter((k) => k !== key));

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-[13px] font-medium">Roles this agent plays</legend>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="radio" name={name} checked={value === null} onChange={() => onChange(null)} className="accent-[var(--accent)]" />
        Every role (one agent does everything)
      </label>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="radio" name={name} checked={value !== null} onChange={() => onChange(value ?? [])} className="accent-[var(--accent)]" />
        Only these roles
      </label>
      {value !== null && (
        <div className="grid gap-1.5 pl-6 sm:grid-cols-2" role="group" aria-label="Roles">
          {list.map((r) => (
            <label key={r.key} className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={value.includes(r.key)} onChange={(e) => toggle(r.key, e.target.checked)} className="accent-[var(--accent)]" />
              <span className="size-2 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />
              {r.name}
            </label>
          ))}
        </div>
      )}
      {value !== null && value.length === 0 && <p className="text-xs text-danger">Choose at least one role.</p>}
      <p className="text-xs text-muted">Running several agents? Give each its own token and roles, for example one that builds and one that reviews and tests. Only a Project Manager runs the kickoff, planning and sprint reviews.</p>
    </fieldset>
  );
}

/** "Every role" or the role names, for lists. */
export function roleSummary(roleKeys: string[] | null, names: Map<string, string>): string {
  return roleKeys ? roleKeys.map((k) => names.get(k) ?? k).join(', ') : 'Every role';
}
