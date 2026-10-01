import type { ReactNode } from "react";

interface ToggleProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}

export function Toggle({ id, checked, onChange, children }: ToggleProps) {
  return (
    <label>
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />{" "}
      {children}
    </label>
  );
}
