/**
 * An example screen made only from this design system's components: a budgeting dashboard in cards, the way an app
 * would use them. Every color, corner, font and spacing comes from the tokens, so it follows the brand and mode in
 * the toolbar. A card shows when this design system has the components it needs; add components and more appear.
 * Managed by Plinth (this folder is rewritten from the template). It is not a component: it is left out of the
 * components manifest and of the tests.
 */
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { composeStories, type Meta, type StoryObj } from "@storybook/react-vite";
import * as icons from "@/icons";

type Mod = Record<string, unknown>;
// Loaded when the page shows, like the All components page: only the components this design system has, and the
// chart's own stories for the one chart (so this page needs no chart library of its own).
const componentLoaders = import.meta.glob<Mod>(["../components/*/*.tsx", "!../components/*/*.stories.tsx"]);
const chartStories = import.meta.glob<Mod>("../components/chart/chart.stories.tsx");

// Components arrive at run time, so their props are not checked here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Part = ComponentType<any>;
type Kit = Record<string, Part> & { has: (...ids: string[]) => boolean };

function Icon({ name, className }: { name: string; className?: string }) {
  const Found = (icons as unknown as Record<string, Part | undefined>)[name];
  return Found ? <Found className={className} aria-hidden="true" /> : null;
}

function useKit() {
  const [kit, setKit] = useState<Kit | null>(null);
  useEffect(() => {
    let off = false;
    const own = Object.entries(componentLoaders).filter(([path]) => {
      const [dir, file] = path.split("/").slice(-2);
      return file === `${dir}.tsx`;
    });
    Promise.all([
      Promise.all(own.map(async ([path, load]) => [path.split("/").at(-2) ?? path, await load()] as const)),
      Promise.all(Object.values(chartStories).map((load) => load())),
    ]).then(([mods, charts]) => {
      if (off) return;
      const parts: Record<string, Part> = {};
      for (const [, mod] of mods) for (const [name, value] of Object.entries(mod)) if (value) parts[name] = value as Part;
      if (charts[0]) {
        const stories = composeStories(charts[0] as Parameters<typeof composeStories>[0]) as Record<string, Part>;
        const chart = stories.Monthly ?? stories.Bars;
        if (chart) parts.MonthlyChart = chart;
      }
      const ids = new Set(mods.map(([id]) => id));
      setKit({ ...parts, has: (...want: string[]) => want.every((w) => ids.has(w)) } as Kit);
    });
    return () => {
      off = true;
    };
  }, []);
  return kit;
}

// A tinted box inside a card, its corners a little tighter than the card's.
const inset = "rounded-[calc(var(--radius-card)*0.6)] bg-muted/50";

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className={`flex flex-col gap-1 p-3 ${inset}`}>
      <span className="type-label-sm text-muted-foreground uppercase">{label}</span>
      <span className="type-heading-sm">{value}</span>
      <span className="type-body-sm text-muted-foreground">{note}</span>
    </div>
  );
}

function Starter({ k }: { k: Kit }) {
  const { Card, CardContent, Button, Badge, Input } = k;
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Button>
            Add expense
            <Icon name="ArrowRightIcon" />
          </Button>
          <Button variant="secondary">Import</Button>
          <Button variant="outline">Export</Button>
        </div>
        {k.has("input-group") ? (
          <k.InputGroup>
            <k.InputGroupInput placeholder="Search transactions" aria-label="Search transactions" />
            <k.InputGroupAddon align="inline-end">
              <Icon name="SearchIcon" />
            </k.InputGroupAddon>
          </k.InputGroup>
        ) : (
          <Input placeholder="Search transactions" aria-label="Search transactions" />
        )}
        {k.has("textarea") && <k.Textarea placeholder="Add a note to this expense" aria-label="Note" />}
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Paid</Badge>
          <Badge variant="secondary">Pending</Badge>
          <span className="ml-auto flex items-center gap-3">
            {k.has("radio-group") && (
              <k.RadioGroup defaultValue="list" className="flex gap-2" aria-label="Show as">
                <k.RadioGroupItem value="list" aria-label="List" />
                <k.RadioGroupItem value="grid" aria-label="Grid" />
              </k.RadioGroup>
            )}
            {k.has("checkbox") && <k.Checkbox defaultChecked aria-label="Include pending" />}
            {k.has("switch") && <k.Switch defaultChecked aria-label="Round up to save" />}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {k.has("alert-dialog") && (
            <k.AlertDialog>
              <k.AlertDialogTrigger asChild>
                <Button variant="outline">Delete category</Button>
              </k.AlertDialogTrigger>
              <k.AlertDialogContent size="sm">
                <k.AlertDialogHeader>
                  <k.AlertDialogTitle>Delete “Dining out”?</k.AlertDialogTitle>
                  <k.AlertDialogDescription>Its 23 expenses move to Other.</k.AlertDialogDescription>
                </k.AlertDialogHeader>
                <k.AlertDialogFooter>
                  <k.AlertDialogCancel>Cancel</k.AlertDialogCancel>
                  <k.AlertDialogAction variant="destructive">Delete</k.AlertDialogAction>
                </k.AlertDialogFooter>
              </k.AlertDialogContent>
            </k.AlertDialog>
          )}
          {k.has("button-group") && (
            <k.ButtonGroup aria-label="Period">
              <Button variant="outline">This month</Button>
              <Button variant="outline" size="icon" aria-label="Pick a period">
                <Icon name="ChevronDownIcon" />
              </Button>
            </k.ButtonGroup>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function NavList({ k, title, rows, current }: { k: Kit; title: string; rows: [string, string][]; current?: string }) {
  const { Card, CardContent } = k;
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-0.5">
        <p className="px-2.5 pb-1 type-label-sm text-muted-foreground">{title}</p>
        {rows.map(([label, icon]) => (
          <k.Item key={label} asChild size="xs" variant={label === current ? "muted" : "default"}>
            <a href={`#${label.toLowerCase()}`} aria-current={label === current ? "page" : undefined}>
              <k.ItemMedia variant="icon">
                <Icon name={icon} />
              </k.ItemMedia>
              <k.ItemContent>
                <k.ItemTitle>{label}</k.ItemTitle>
              </k.ItemContent>
            </a>
          </k.Item>
        ))}
      </CardContent>
    </Card>
  );
}

function Navigation({ k }: { k: Kit }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <NavList
        k={k}
        title="Plan"
        current="Budgets"
        rows={[["Overview", "LayoutDashboardIcon"], ["Budgets", "WalletIcon"], ["Bills", "ReceiptIcon"], ["Goals", "TargetIcon"], ["Calendar", "CalendarIcon"]]}
      />
      <NavList
        k={k}
        title="Account"
        rows={[["Profile", "UserIcon"], ["Billing", "CreditCardIcon"], ["Alerts", "BellIcon"], ["Security", "ShieldIcon"], ["Appearance", "PaletteIcon"]]}
      />
    </div>
  );
}

const goals = [
  { name: "Emergency fund", saved: "$8,400", target: "$12,000", pct: 70 },
  { name: "New laptop", saved: "$1,250", target: "$2,400", pct: 52 },
];

function SavingsGoals({ k }: { k: Kit }) {
  const { Card, CardHeader, CardTitle, CardDescription, CardContent } = k;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Savings goals</CardTitle>
        <CardDescription>Two goals this year, both on track.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {goals.map((g) => (
          <div key={g.name} className={`flex flex-col gap-3 p-4 ${inset}`}>
            <span className="type-label-sm text-muted-foreground uppercase">{g.name}</span>
            <span className="type-display">{g.saved}</span>
            <k.Progress value={g.pct} aria-label={`${g.name}: ${g.pct}% saved`} />
            <div className="flex justify-between type-body-sm text-muted-foreground">
              <span>{g.pct}% saved</span>
              <span>of {g.target}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SpendingHistory({ k }: { k: Kit }) {
  const { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, MonthlyChart } = k;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Spending history</CardTitle>
        <CardDescription>The last six months</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <MonthlyChart className="aspect-auto h-44 w-full" />
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Next bill" value="Nov 3" note="Rent, $1,200" />
          <Stat label="This month" value="On track" note="12 days left" />
        </div>
        <Button className="w-full">See the full report</Button>
      </CardContent>
    </Card>
  );
}

const flow = [
  ["Income", "$4,800.00"],
  ["Bills", "−$2,140.00"],
  ["Spent so far", "−$1,448.71"],
] as const;

function LeftToSpend({ k }: { k: Kit }) {
  const { Card, CardContent, Badge } = k;
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="type-body-md text-muted-foreground">Left to spend in October</span>
          <span className="type-display">$1,211.29</span>
          <Badge variant="warning" className="self-start">3 bills due this week</Badge>
        </div>
        <div className={`flex flex-col gap-2 p-4 ${inset}`}>
          {flow.map(([label, amount]) => (
            <div key={label} className="flex justify-between type-body-md">
              <span className="text-muted-foreground">{label}</span>
              <span className="tabular-nums">{amount}</span>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t pt-3 type-label-md">
            <span>Left</span>
            <span className="tabular-nums">$1,211.29</span>
          </div>
        </div>
        <p className="type-body-sm text-muted-foreground">Bills are taken out on the day they are due. Pay day is November 1.</p>
      </CardContent>
    </Card>
  );
}

const subscriptions = [
  { name: "Streaming", note: "Renews Nov 4", price: "$15.99", months: [60, 60, 100, 100] },
  { name: "Music", note: "Renews Nov 12", price: "$10.99", months: [100, 100, 100, 100] },
  { name: "Cloud storage", note: "Renews Nov 20", price: "$2.99", months: [40, 40, 40, 70] },
  { name: "Gym", note: "Renews Dec 1", price: "$45.00", months: [100, 80, 100, 90] },
];

function Subscriptions({ k }: { k: Kit }) {
  const { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, Button } = k;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Subscriptions</CardTitle>
        <CardDescription>4 active, $74.97 a month</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label="Hide subscriptions">
            <Icon name="XIcon" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {subscriptions.map((s) => (
          <k.Item key={s.name} variant="muted" size="sm">
            <k.ItemContent>
              <k.ItemTitle>{s.name}</k.ItemTitle>
              <k.ItemDescription>
                {s.note} · {s.price}
              </k.ItemDescription>
            </k.ItemContent>
            <k.ItemActions aria-label={`${s.name}, last four months`} className="h-6 items-end gap-1">
              {s.months.map((m, i) => (
                <span key={i} className="w-2 rounded-xs bg-chart-1" style={{ height: `${m}%`, opacity: 0.45 + (0.55 * i) / 3 }} />
              ))}
            </k.ItemActions>
          </k.Item>
        ))}
      </CardContent>
    </Card>
  );
}

function NewGoal({ k }: { k: Kit }) {
  const { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Input, Label } = k;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Set a savings goal</CardTitle>
        <CardDescription>Pick a target and a date, and we work out how much to put aside each month.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="goal-name">Goal</Label>
          <Input id="goal-name" placeholder="A new laptop, a trip…" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="goal-amount">Amount</Label>
            <Input id="goal-amount" defaultValue="$2,400" inputMode="decimal" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="goal-date">By</Label>
            <Input id="goal-date" defaultValue="March 2027" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Button className="w-full">Create goal</Button>
          <Button variant="outline" className="w-full">
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SpendingLimit({ k }: { k: Kit }) {
  const { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, Button, Label } = k;
  const [limit, setLimit] = useState([250]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Spending limit</CardTitle>
        <CardDescription>We let you know when a category gets close.</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label="Close">
            <Icon name="XIcon" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label>Category</Label>
          <k.Select defaultValue="dining">
            <k.SelectTrigger className="w-full" aria-label="Category">
              <k.SelectValue />
            </k.SelectTrigger>
            <k.SelectContent>
              <k.SelectItem value="dining">Dining out</k.SelectItem>
              <k.SelectItem value="groceries">Groceries</k.SelectItem>
              <k.SelectItem value="transport">Transport</k.SelectItem>
            </k.SelectContent>
          </k.Select>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <Label>A week</Label>
            <span className="type-heading-lg tabular-nums">${limit[0]}</span>
          </div>
          <k.Slider value={limit} onValueChange={setLimit} min={50} max={1000} step={10} aria-label="Limit a week" />
          <div className="flex justify-between type-body-sm text-muted-foreground">
            <span>$50</span>
            <span>$1,000</span>
          </div>
        </div>
        {k.has("textarea") && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="limit-note">Note to self</Label>
            <k.Textarea id="limit-note" placeholder="Takeaway counts too" />
          </div>
        )}
        <Button className="w-full">Save limit</Button>
      </CardContent>
    </Card>
  );
}

function Security({ k }: { k: Kit }) {
  const { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Input, Label } = k;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-in and security</CardTitle>
        <CardDescription>Change your email or password. We ask for your password again first.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="security-email">Email</Label>
          <Input id="security-email" type="email" defaultValue="sam@example.com" />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="security-password">Password</Label>
            <a href="#forgot" className="type-label-sm text-muted-foreground underline-offset-4 hover:underline">
              Forgot it?
            </a>
          </div>
          <Input id="security-password" type="password" defaultValue="correct horse" />
        </div>
        <Button className="w-full">
          <Icon name="LockIcon" />
          Update
        </Button>
        <k.Item asChild variant="outline" size="sm">
          <a href="#delete">
            <k.ItemMedia variant="icon" className="text-destructive">
              <Icon name="TriangleAlertIcon" />
            </k.ItemMedia>
            <k.ItemContent>
              <k.ItemTitle>Delete account</k.ItemTitle>
              <k.ItemDescription>Your budgets and history go with it.</k.ItemDescription>
            </k.ItemContent>
            <Icon name="ChevronRightIcon" className="size-4 text-muted-foreground" />
          </a>
        </k.Item>
      </CardContent>
    </Card>
  );
}

function ConnectBank({ k }: { k: Kit }) {
  const { Card, CardContent, Button } = k;
  return (
    <Card>
      <CardContent>
        <k.Empty>
          <k.EmptyHeader>
            <k.EmptyMedia variant="icon">
              <Icon name="LandmarkIcon" />
            </k.EmptyMedia>
            <k.EmptyTitle>Connect your bank</k.EmptyTitle>
            <k.EmptyDescription>See every account in one place. Read-only: nobody can move money from here.</k.EmptyDescription>
          </k.EmptyHeader>
          <k.EmptyContent>
            <Button>Connect a bank</Button>
            <Button variant="link">Add an account by hand</Button>
          </k.EmptyContent>
        </k.Empty>
      </CardContent>
    </Card>
  );
}

function Chat({ k }: { k: Kit }) {
  const { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, Button } = k;
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>New chat</CardTitle>
        <CardDescription>Ask about your money</CardDescription>
        <CardAction>
          <Button variant="outline" size="icon-sm" aria-label="Start over">
            <Icon name="RefreshCwIcon" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <k.Empty className="py-10">
          <k.EmptyHeader>
            <k.EmptyMedia variant="icon">
              <Icon name="MessageCircleIcon" />
            </k.EmptyMedia>
            <k.EmptyTitle>Good morning, Sam</k.EmptyTitle>
            <k.EmptyDescription>What would you like to know about your spending?</k.EmptyDescription>
          </k.EmptyHeader>
        </k.Empty>
        <k.InputGroup>
          <k.InputGroupTextarea placeholder="How much did I spend on food last month?" aria-label="Message" />
          <k.InputGroupAddon align="block-end">
            <k.InputGroupButton variant="outline" size="icon-xs" className="rounded-full" aria-label="Add a file">
              <Icon name="PlusIcon" />
            </k.InputGroupButton>
            <k.InputGroupButton variant="default" size="icon-xs" className="ml-auto rounded-full" aria-label="Send">
              <Icon name="ArrowUpIcon" />
            </k.InputGroupButton>
          </k.InputGroupAddon>
        </k.InputGroup>
      </CardContent>
    </Card>
  );
}

const transfers = [
  ["Change transfer limit", "How much you can send a day", "ArrowLeftRightIcon"],
  ["Scheduled transfers", "Send money on a date you pick", "CalendarClockIcon"],
  ["Recurring payments", "Rent, subscriptions and other bills", "RepeatIcon"],
] as const;

function Transfers({ k }: { k: Kit }) {
  const { Card, CardContent } = k;
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <k.Breadcrumb>
          <k.BreadcrumbList>
            <k.BreadcrumbItem>
              <k.BreadcrumbLink href="#home">Home</k.BreadcrumbLink>
            </k.BreadcrumbItem>
            <k.BreadcrumbSeparator />
            <k.BreadcrumbItem>
              <k.BreadcrumbEllipsis />
            </k.BreadcrumbItem>
            <k.BreadcrumbSeparator />
            <k.BreadcrumbItem>
              <k.BreadcrumbPage>Transfers</k.BreadcrumbPage>
            </k.BreadcrumbItem>
          </k.BreadcrumbList>
        </k.Breadcrumb>
        <div className="flex flex-col gap-2">
          {transfers.map(([title, note, icon]) => (
            <k.Item key={title} asChild variant="muted" size="sm">
              <a href={`#${icon}`}>
                <k.ItemMedia variant="icon">
                  <Icon name={icon} />
                </k.ItemMedia>
                <k.ItemContent>
                  <k.ItemTitle>{title}</k.ItemTitle>
                  <k.ItemDescription>{note}</k.ItemDescription>
                </k.ItemContent>
                <Icon name="ChevronRightIcon" className="size-4 text-muted-foreground" />
              </a>
            </k.Item>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

type Tile = { needs: string[]; chart?: boolean; Show: ComponentType<{ k: Kit }> };
// Four columns, each a stack of cards; on narrow screens they fold into two, then one.
const columns: Tile[][] = [
  [
    { needs: ["card", "button", "badge", "input"], Show: Starter },
    { needs: ["card", "item"], Show: Navigation },
    { needs: ["card", "progress"], Show: SavingsGoals },
  ],
  [
    { needs: ["card", "button"], chart: true, Show: SpendingHistory },
    { needs: ["card", "badge"], Show: LeftToSpend },
    { needs: ["card", "button", "item"], Show: Subscriptions },
  ],
  [
    { needs: ["card", "button", "input", "label"], Show: NewGoal },
    { needs: ["card", "button", "label", "select", "slider"], Show: SpendingLimit },
    { needs: ["card", "button", "input", "label", "item"], Show: Security },
  ],
  [
    { needs: ["card", "button", "empty"], Show: ConnectBank },
    { needs: ["card", "button", "empty", "input-group"], Show: Chat },
    { needs: ["card", "breadcrumb", "item"], Show: Transfers },
  ],
];

function Showcase(): ReactNode {
  const k = useKit();
  if (!k) return <p className="type-body-md p-8 text-muted-foreground">Loading the example…</p>;
  const shown = columns.map((tiles) => tiles.filter((t) => k.has(...t.needs) && (!t.chart || k.MonthlyChart))).filter((tiles) => tiles.length);
  return (
    <div className="min-h-screen bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto grid max-w-screen-2xl items-start gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {shown.map((tiles, i) => (
          <div key={i} className="flex min-w-0 flex-col gap-4">
            {tiles.map(({ Show }) => (
              <Show key={Show.name} k={k} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const meta = {
  title: "Showcase",
  component: Showcase,
  tags: ["!test", "!manifest", "!autodocs"],
  parameters: { layout: "fullscreen", controls: { disable: true }, actions: { disable: true } },
} satisfies Meta<typeof Showcase>;

export default meta;
export const Dashboard: StoryObj<typeof meta> = { name: "Showcase" };
