import { IconButton } from "../ui/components.tsx";

export function EntryAction({ onClick }: { onClick: () => void }) {
  return (
    <div className="floating-entry entry-fab" data-no-back>
      <IconButton
        className="entry-action"
        name="SquarePen"
        label="记一笔"
        onClick={onClick}
      />
    </div>
  );
}
