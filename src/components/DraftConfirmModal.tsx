interface DraftConfirmModalProps {
  player: Player | null;
  onCancel: () => void;
  onConfirm: () => void;
}

const DraftConfirmModal = ({ player, onCancel, onConfirm }: DraftConfirmModalProps) => {
  return (
    <div className="text-base text-gray-800 dark:text-gray-100">
      <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
        Are you sure you want to draft
      </p>
      <span className="font-bold text-gray-800 dark:text-gray-100">{player?.name}</span>
      <p className="text-sm font-medium text-gray-800 dark:text-gray-100">to your team?</p>
    </div>
  );
};

export default DraftConfirmModal;
