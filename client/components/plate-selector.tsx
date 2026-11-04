import { useState } from "react";
import { Check, ImageOff } from "lucide-react";
import { Checkbox } from "./ui/checkbox";

type PlateChoice = { number: number; name?: string; preview?: string | null };
function PlateCard({
  plate,
  selected,
  focused,
  status,
  disabled,
  focus,
  toggle,
}: {
  plate: PlateChoice;
  selected: boolean;
  focused: boolean;
  status: string;
  disabled: boolean;
  focus: () => void;
  toggle: (checked: boolean) => void;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <div
      className={`overflow-hidden rounded-md border ${focused ? "border-primary ring-2 ring-primary/20" : "border-border"}`}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={`Configure plate ${plate.number}`}
        aria-pressed={focused}
        onClick={focus}
        className="block w-full text-left disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-primary"
      >
        <div className="aspect-[3/2] bg-muted/50 flex items-center justify-center overflow-hidden">
          {plate.preview && !broken ? (
            <img
              src={plate.preview}
              alt={`Saved preview of plate ${plate.number}`}
              className="size-full object-contain"
              onError={() => setBroken(true)}
            />
          ) : (
            <span className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
              <ImageOff className="size-6" aria-hidden="true" />
              No saved preview
            </span>
          )}
        </div>
        <div className="px-3 pt-3 space-y-1">
          <p className="flex items-center justify-between gap-2 text-sm font-semibold">
            Plate {plate.number}
            {focused && <span className="text-xs font-normal">Editing</span>}
          </p>
          {plate.name && (
            <p className="truncate text-xs text-muted-foreground">
              {plate.name}
            </p>
          )}
        </div>
      </button>
      <div className="p-3 space-y-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            aria-label={`Include plate ${plate.number}`}
            checked={selected}
            disabled={disabled}
            onCheckedChange={(value) => toggle(value === true)}
          />
          Include plate {plate.number}
        </label>
        <p
          className="flex items-center gap-1 text-xs text-muted-foreground"
          role="status"
        >
          {status === "Ready to submit" && (
            <Check className="size-3" aria-hidden="true" />
          )}
          {status}
        </p>
      </div>
    </div>
  );
}
export function PlateSelector({
  plates,
  selected,
  focused,
  disabled,
  status,
  focus,
  toggle,
}: {
  plates: PlateChoice[];
  selected: number[];
  focused: number;
  disabled: boolean;
  status: (plate: number) => string;
  focus: (plate: number) => void;
  toggle: (plate: number, checked: boolean) => void;
}) {
  return (
    <div className="space-y-3" aria-label="Project plates">
      <div>
        <h3 className="text-sm font-semibold">Choose plates to print</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Include any plates you need. Click a preview to configure that plate's
          source filaments. Saved previews can be stale.
        </p>
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
        {plates.map((plate) => (
          <PlateCard
            key={plate.number}
            plate={plate}
            selected={selected.includes(plate.number)}
            focused={focused === plate.number}
            status={status(plate.number)}
            disabled={disabled}
            focus={() => focus(plate.number)}
            toggle={(checked) => toggle(plate.number, checked)}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground" role="status">
        {selected.length} of {plates.length} plates selected
      </p>
    </div>
  );
}
