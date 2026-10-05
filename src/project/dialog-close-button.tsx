import { i18n } from "../renderer/i18n";
import { Button } from "../renderer/ui/button";

interface DialogCloseButtonProps {
  onClose: () => void;
  label?: string;
  id?: string;
}
export const DialogCloseButton = ({
  onClose,
  label = "common.cancel",
  id,
}: DialogCloseButtonProps) => (
  <Button
    variant="secondary"
    type="button"
    id={id}
    data-close
    onClick={onClose}
  >
    {i18n.t(label)}
  </Button>
);
