import clsx from 'clsx';
import { useId } from 'react';
import { useRoles } from '../../lib/queries';

/**
 * Which roles an agent plays: every role (one agent does everything) or a chosen set, so several
 * agents can work side by side, for example one that builds and one that reviews and tests.
 * `null` means every role; an empty list is not a valid choice. The roles are always listed, so
 * it is clear what "every role" covers.
 */
export function RolePicker({ value, onChange }: { value: string[] | null; onChange: (value: string[] | null) => void }) {
  const roles = useRoles();
  const name = useId();
  const list = (roles.data ?? []).filter((r) => r.enabled);
  const every = value === null;
  const toggle = (key: string, on: boolean) => onChange(on ? [...(value ?? []), key] : (value ?? []).filter((k) => k !== key));

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-[13px] font-medium">Roles this agent plays</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <label className="flex items-center gap-2 text-[13px]">
          <input type="radio" name={name} checked={every} onChange={() => onChange(null)} className="accent-[var(--accent)]" />
          Every role (one agent does everything)
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="radio" name={name} checked={!every} onChange={() => onChange(value ?? [])} className="accent-[var(--accent)]" />
          Only these roles
        </label>
      </div>
      <div className={clsx('grid gap-1.5 rounded-lg border border-line p-3 sm:grid-cols-2', every && 'opacity-60')} role="group" aria-label="Roles">
        {list.map((r) => (
          <label key={r.key} className={clsx('flex items-center gap-2 text-[13px]', every && 'cursor-not-allowed')}>
            <input
              type="checkbox"
              checked={every || value.includes(r.key)}
              disabled={every}
              onChange={(e) => toggle(r.key, e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span className="size-2 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />
            {r.name}
          </label>
        ))}
      </div>
      {!every && value.length === 0 && <p className="text-xs text-danger">Choose at least one role.</p>}
      <p className="text-xs text-muted">
        Running several agents? Give each its own token and roles, for example one that builds and one that reviews and tests. Only a Project Manager runs the kickoff,
        planning and sprint reviews.
      </p>
    </fieldset>
  );
}

/** "Every role" or the role names, for lists. */
export function roleSummary(roleKeys: string[] | null, names: Map<string, string>): string {
  return roleKeys ? roleKeys.map((k) => names.get(k) ?? k).join(', ') : 'Every role';
}
