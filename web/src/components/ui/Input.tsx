import { InputHTMLAttributes, forwardRef } from "react";

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return (
      <input
        ref={ref}
        {...props}
        style={{
          flex: 1, border: "none", outline: "none", background: "transparent",
          padding: "8px 10px", fontSize: 13, color: "var(--ink)",
          ...props.style,
        }}
      />
    );
  }
);

export default Input;
