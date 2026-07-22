import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  // iOS Safari ignores box-sizing on date controls: padding and border are added to width/height
  // instead of being absorbed, so the field always paints ~22px wider than the box it was given
  // and spills over its neighbour (or out of the sheet). Give the input neither — the wrapper
  // draws the field, and overflow-hidden keeps any residual native paint inside it.
  if (type === "date")
    return (
      <div
        className={cn(
          "flex h-8 w-full min-w-0 items-center overflow-hidden rounded-lg border border-input bg-transparent px-2.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30",
          className
        )}
      >
        <InputPrimitive
          type={type}
          data-slot="input"
          className="h-full w-full min-w-0 border-0 bg-transparent p-0 text-base outline-none md:text-sm"
          {...props}
        />
      </div>
    )

  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
