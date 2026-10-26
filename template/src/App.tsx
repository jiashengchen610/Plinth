import { Button } from "@/components/button/button";

export default function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Design system</h1>
      <p className="text-muted-foreground">
        Components live in Storybook. Run <code>npm run storybook</code> to browse them.
      </p>
      <div>
        <Button>Primary action</Button>
      </div>
    </main>
  );
}
