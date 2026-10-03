import clsx from 'clsx';
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-fg">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode; error?: string };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, hint, error, className, id, ...rest }, ref) {
  const auto = useId();
  const inputId = id ?? auto;
  const input = (
    <input
      ref={ref}
      id={inputId}
      aria-invalid={Boolean(error) || undefined}
      className={clsx('field-input h-9', error && 'border-danger', className)}
      {...rest}
    />
  );
  if (!label && !hint && !error) return input;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      {input}
    </Field>
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; hint?: ReactNode; error?: string };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, id, rows = 4, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  const area = (
    <textarea
      ref={ref}
      id={inputId}
      rows={rows}
      aria-invalid={Boolean(error) || undefined}
      className={clsx('field-input resize-y leading-relaxed', error && 'border-danger', className)}
      {...rest}
    />
  );
  if (!label && !hint && !error) return area;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      {area}
    </Field>
  );
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode; hint?: ReactNode; error?: string };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, className, id, children, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  const select = (
    <select ref={ref} id={inputId} className={clsx('field-input h-9 cursor-pointer pr-8', className)} {...rest}>
      {children}
    </select>
  );
  if (!label && !hint && !error) return select;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      {select}
    </Field>
  );
});

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-[13px] font-medium text-fg">
          {label}
        </label>
        {description && <p className="mt-0.5 text-xs text-subtle">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-50',
          checked ? 'brand-gradient' : 'bg-surface-3',
        )}
      >
        <span className={clsx('inline-block size-4 rounded-full bg-white shadow transition', checked ? 'translate-x-4.5' : 'translate-x-0.5')} />
      </button>
    </div>
  );
}
