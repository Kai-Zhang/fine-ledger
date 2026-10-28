import { useId } from "react";
export function DateTimeField({
  label,
  value,
  onChange,
  onSecondsEdit,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSecondsEdit?: () => void;
}) {
  const id = useId();
  const seconds = value.slice(17, 19);
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="datetime-controls">
        <input
          id={id}
          aria-label={label}
          type="datetime-local"
          step="60"
          value={value.slice(0, 16)}
          onChange={(e) => {
            if (e.target.value) onChange(`${e.target.value}:${seconds}`);
          }}
          required
        />
        <label className="seconds-control">
          <input
            aria-label={`${label}的秒`}
            type="text"
            inputMode="numeric"
            maxLength={2}
            value={seconds}
            onChange={(e) => {
              const n = e.target.value;
              if (/^\d{0,2}$/.test(n) && Number(n) <= 59) {
                onSecondsEdit?.();
                onChange(`${value.slice(0, 16)}:${n}`);
              }
            }}
            onBlur={() => {
              if (seconds.length < 2)
                onChange(`${value.slice(0, 16)}:${seconds.padStart(2, "0")}`);
            }}
          />
          <span>秒</span>
        </label>
      </div>
    </div>
  );
}
