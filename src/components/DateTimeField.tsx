import { useId, useState, useRef, useEffect } from "react";
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
  const id = useId(),
    lastEmitted = useRef(value);
  const read = (v: string) => [
    v.slice(11, 13),
    v.slice(14, 16),
    v.slice(17, 19),
  ];
  const [parts, setParts] = useState(() => read(value));
  useEffect(() => {
    if (value !== lastEmitted.current) {
      setParts(read(value));
      lastEmitted.current = value;
    }
  }, [value]);
  function emit(date: string, next: string[]) {
    const result = date + "T" + next.map((p) => p.padStart(2, "0")).join(":");
    lastEmitted.current = result;
    onChange(result);
  }
  function update(index: number, raw: string) {
    if (!/^\d{0,2}$/.test(raw) || Number(raw) > (index === 0 ? 23 : 59)) return;
    if (index === 2) onSecondsEdit?.();
    const next = parts.slice();
    next[index] = raw;
    setParts(next);
    emit(value.slice(0, 10), next);
  }
  return (
    <div className="field datetime-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="datetime-pair">
        <input
          id={id}
          aria-label={`${label}日期`}
          type="date"
          value={value.slice(0, 10)}
          onChange={(e) => {
            if (e.target.value) emit(e.target.value, parts);
          }}
          required
        />
        <div
          className="clock-control"
          role="group"
          aria-label={`${label}时分秒`}
        >
          {parts.map((part, i) => (
            <span key={i}>
              {i > 0 && <b>:</b>}
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{1,2}"
                maxLength={2}
                required
                aria-label={`${label}的${["时", "分", "秒"][i]}`}
                value={part}
                onChange={(e) => update(i, e.target.value)}
                onBlur={() => {
                  if (part.length < 2) update(i, part.padStart(2, "0"));
                }}
              />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
