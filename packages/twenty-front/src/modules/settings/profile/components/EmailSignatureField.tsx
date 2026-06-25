import { styled } from '@linaria/react';
import { useState } from 'react';

import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { useFindOneRecord } from '@/object-record/hooks/useFindOneRecord';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { useColorScheme } from '@/ui/theme/hooks/useColorScheme';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { CoreObjectNameSingular } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledTextArea = styled.textarea`
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  font-family: ${themeCssVariables.font.family};
  font-size: ${themeCssVariables.font.size.md};
  min-height: 120px;
  padding: ${themeCssVariables.spacing[2]};
  resize: vertical;
  width: 100%;
`;

const StyledPreviewLabel = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledPreview = styled.iframe`
  background: transparent;
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.sm};
  height: 96px;
  width: 100%;
`;

const StyledActions = styled.div`
  display: flex;
`;

// Force the signature text white inside the preview when Twenty is in dark mode
// (the signature HTML itself keeps its dark color for the actual email).
const buildPreviewDocument = (html: string, isDark: boolean): string => {
  const baseStyle = `<style>html,body{margin:0;background:transparent;}${
    isDark ? 'body,body *{color:#ffffff !important;}' : ''
  }</style>`;

  return `${baseStyle}${html}`;
};

export const EmailSignatureField = () => {
  const currentWorkspaceMember = useAtomStateValue(currentWorkspaceMemberState);
  const workspaceMemberId = currentWorkspaceMember?.id ?? '';

  const { colorScheme } = useColorScheme();
  const isDark =
    colorScheme === 'Dark' ||
    (colorScheme === 'System' &&
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches === true);

  const { record, loading } = useFindOneRecord({
    objectNameSingular: CoreObjectNameSingular.WorkspaceMember,
    objectRecordId: workspaceMemberId,
    skip: !isDefined(currentWorkspaceMember?.id),
  });

  const { updateOneRecord } = useUpdateOneRecord();

  const [draft, setDraft] = useState<string | null>(null);

  const savedSignature =
    (record as { emailSignature?: string | null } | undefined)
      ?.emailSignature ?? '';
  const value = draft ?? savedSignature;

  const handleSave = async () => {
    if (!isDefined(currentWorkspaceMember?.id)) {
      return;
    }

    await updateOneRecord({
      objectNameSingular: CoreObjectNameSingular.WorkspaceMember,
      idToUpdate: currentWorkspaceMember.id,
      updateOneRecordInput: { emailSignature: value },
    });

    setDraft(null);
  };

  if (loading) {
    return null;
  }

  return (
    <StyledContainer>
      <StyledTextArea
        value={value}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Paste your HTML email signature"
        spellCheck={false}
      />
      <StyledPreviewLabel>Preview</StyledPreviewLabel>
      <StyledPreview
        title="email-signature-preview"
        srcDoc={buildPreviewDocument(value, isDark)}
        sandbox=""
      />
      <StyledActions>
        <Button
          title="Save"
          variant="primary"
          onClick={handleSave}
          disabled={draft === null}
          type="button"
        />
      </StyledActions>
    </StyledContainer>
  );
};
