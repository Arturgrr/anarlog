import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";

import { CaretDown, Globe } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";

import { SOURCE_LOCALE } from "~/i18n/locales";
import {
  CORE_TRANSCRIPTION_LANGUAGE_CODES,
  getAdditionalSpokenLanguages,
  getBaseLanguageCode,
  getBaseLanguageDisplayName,
} from "~/settings/general/language";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "~/settings/general/searchable-select";
import { useSetSettingValues } from "~/settings/queries";
import { useConfigValues } from "~/shared/config";

export function WelcomeLanguagePicker() {
  const { i18n, t } = useLingui();
  const { ai_language, spoken_languages } = useConfigValues([
    "ai_language",
    "spoken_languages",
  ]);
  const setSettingValues = useSetSettingValues();

  const options: SearchableSelectOption[] = useMemo(
    () =>
      CORE_TRANSCRIPTION_LANGUAGE_CODES.map((code) => {
        const label = getNativeLanguageName(code);
        const localizedName = getBaseLanguageDisplayName(code, i18n.locale);
        return {
          value: code,
          label,
          detail:
            localizedName.toLocaleLowerCase() === label.toLocaleLowerCase()
              ? undefined
              : localizedName,
        };
      }).sort((a, b) => a.label.localeCompare(b.label, i18n.locale)),
    [i18n.locale],
  );

  const value = getBaseLanguageCode(ai_language) || SOURCE_LOCALE;
  const languageName = getNativeLanguageName(value);

  const handleChange = (code: string) => {
    setSettingValues({
      ai_language: code,
      spoken_languages: JSON.stringify(
        getAdditionalSpokenLanguages(code, spoken_languages),
      ),
    });
  };

  return (
    <SearchableSelect
      value={value}
      onChange={handleChange}
      options={options}
      searchPlaceholder={t`Search language...`}
      emptyMessage={t`No matching languages found`}
      align="end"
      dropdownClassName="w-64"
      trigger={
        <Button
          type="button"
          variant="ghost"
          role="combobox"
          data-tauri-drag-region="false"
          aria-label={t`Language: ${languageName}`}
          className="text-muted-foreground gap-1 px-1.5 font-normal"
        >
          <Globe size={16} />
          <span className="text-xs">{languageName}</span>
          <CaretDown size={12} className="opacity-60" />
        </Button>
      }
    />
  );
}

function getNativeLanguageName(code: string) {
  const name = getBaseLanguageDisplayName(code, code);
  return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
}
