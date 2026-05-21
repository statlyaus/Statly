import type { Player } from '../types/players';

interface DraftConfirmModalProps {
  player: Player | null;
  onCancel: () => void;
  onConfirm: () => void;
}

const DraftConfirmModal = ({ player, onCancel, onConfirm }: DraftConfirmModalProps) => {
  if (!player) return null;
  return (
    <div className="text-base text-foreground dark:text-muted-foreground">
      <p className="text-sm font-medium text-foreground dark:text-muted-foreground">
        Are you sure you want to draft
      </p>
      <span className="font-bold text-foreground dark:text-muted-foreground">{player.name}</span>
      <p className="text-sm font-medium text-foreground dark:text-muted-foreground">to your team?</p>
      <div className="mt-2 flex gap-2">
        <button onClick={onCancel} className="btn btn-sm">
          Cancel
        </button>
        <button onClick={onConfirm} className="btn btn-sm btn-primary">
          Confirm
        </button>
      </div>
    </div>
  );
};

export default DraftConfirmModal;
