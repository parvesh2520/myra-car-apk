interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
  disabled?: boolean;
  valueText?: string;
  className?: string;
}

export function Slider({ value, min, max, step = 1, onChange, label, disabled, valueText, className = '' }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className={`range ${className}`}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={label}
      aria-valuetext={valueText}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ ['--fill' as string]: `${pct}%` }}
    />
  );
}
