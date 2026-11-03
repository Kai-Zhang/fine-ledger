import { useId, useState, useRef, useEffect } from "react";

const validPart = (index: number, text: string) =>
  /^\d{0,2}$/.test(text) && Number(text) <= (index === 0 ? 23 : 59);

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
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
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
  function update(index: number, incoming: string[]) {
    if (
      index + incoming.length > parts.length ||
      incoming.some((text, offset) => !validPart(index + offset, text))
    )
      return;
    if (index + incoming.length === 3) onSecondsEdit?.();
    const next = parts.slice();
    next.splice(index, incoming.length, ...incoming);
    setParts(next);
    emit(value.slice(0, 10), next);
    if (incoming.at(-1)?.length === 2) {
      const following = inputs.current[index + incoming.length];
      // The next segment is on the same row. Keep it at the current scroll position.
      following?.focus({ preventScroll: true });
    }
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
                ref={(input) => {
                  inputs.current[i] = input;
                }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]{1,2}"
                maxLength={2}
                required
                aria-label={`${label}的${["时", "分", "秒"][i]}`}
                value={part}
                onFocus={(e) => e.currentTarget.select()}
                onClick={(e) => e.currentTarget.select()}
                onChange={(e) => update(i, [e.target.value])}
                onPaste={(e) => {
                  e.preventDefault();
                  const text = e.clipboardData.getData("text").trim();
                  if (/^\d{2}(?::?\d{2}){0,2}$/.test(text)) {
                    update(i, text.match(/\d{2}/g)!);
                  }
                }}
                onBlur={() => {
                  setParts((previous) =>
                    previous[i].length === 2
                      ? previous
                      : previous.map((text, index) =>
                          index === i ? text.padStart(2, "0") : text,
                        ),
                  );
                }}
              />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
