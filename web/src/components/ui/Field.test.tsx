import { render, screen } from "@testing-library/react";
import Field from "./Field";
import Input from "./Input";

test("renders label and hint", () => {
  render(
    <Field label="Email" hint="Use your work email">
      <Input placeholder="you@co" />
    </Field>
  );
  expect(screen.getByText("Email")).toBeInTheDocument();
  expect(screen.getByText("Use your work email")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("you@co")).toBeInTheDocument();
});
