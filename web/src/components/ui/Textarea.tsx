import { TextareaHTMLAttributes, forwardRef } from "react";

const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea(props, ref) {
    return (
      <textarea
        ref={ref}
        {...props}
        style={{
          flex: 1, border: "none", outline: "none", background: "transparent",
          padding: "8px 10px", fontSize: 13, color: "var(--ink)",
          fontFamily: "var(--f-sans)", resize: "vertical", minHeight: 80,
          ...props.style,
        }}
      />
    );
  }
);

export default Textarea;
