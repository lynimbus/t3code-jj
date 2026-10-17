import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Pressable, View } from "react-native";
import { T, useGT } from "gt-react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import type { Preferences } from "../../persistence/mobile-preferences";

export function VcsFallbackNotice(props: {
  environmentId: string;
  repository: string;
  notice: string;
  reason: string | null;
}) {
  const gt = useGT();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomCommand(saveMobilePreferences, { reportFailure: false });
  const key = JSON.stringify([props.environmentId, props.repository]);
  const fingerprint = JSON.stringify([props.notice, props.reason]);
  if (
    AsyncResult.isSuccess(preferences) &&
    preferences.value.dismissedVcsNotices?.[key] === fingerprint
  )
    return null;
  return (
    <View className="gap-2 border-b border-border bg-card px-4 py-3">
      <Text className="text-sm text-muted-foreground">{props.notice}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={gt("Dismiss repository fallback notice")}
        onPress={() =>
          void savePreferences({
            transform: (current: Preferences) => ({
              dismissedVcsNotices: { ...current.dismissedVcsNotices, [key]: fingerprint },
            }),
          })
        }
      >
        <Text className="text-sm text-primary">
          <T>Dismiss</T>
        </Text>
      </Pressable>
    </View>
  );
}
