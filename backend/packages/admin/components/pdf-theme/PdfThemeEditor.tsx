'use client';

// =============================================================================
// PdfThemeEditor — Settings → PDF Theme client UI.
//
// Two-pane layout (mirrors FieldBuilder):
//   LEFT  — scrollable grouped controls: brand colors, fonts, footer, QMI
//            options, disclaimers, esperanzaDifference copy.
//   RIGHT — live preview iframe (refreshed on every debounced save).
//
// Writes: saveDraftTheme on each debounced change; publishTheme / revertDraftTheme
// from the action bar.
//
// V1 simplifications (noted for follow-up):
//   - Logo/image fields use plain text <input> for URL instead of an ImageUploader
//     widget — defer to Phase C when the R2 uploader is wired up.
//   - Rich-text esperanzaDifference uses a plain <textarea> — RichTextField
//     integration can follow in Phase C.
//   - sectionLabels.case is a plain text input rather than a Select (low-traffic field).
// =============================================================================

import { useState, useTransition, useRef, useCallback, useEffect } from 'react';
import { parseTheme, type Theme } from '@esperanza/pdf/theme';
import {
  saveDraftTheme,
  publishTheme,
  revertDraftTheme,
} from '@/lib/pdf-theme-actions';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface SampleSlug {
  type: string;
  slug: string;
}

interface Props {
  draftJson: string;
  draftVersion: number;
  activeVersion: number;
  samples: SampleSlug[];
  userEmail: string;
}

/** Inline logo preview — renders the IMAGE itself (operator DAM rule: never a bare URL).
 *  Empty or stale-Airtable URLs fall back to a muted placeholder tile. Checkerboard-ish
 *  muted background reads transparent PNGs (logos are usually transparent). */
function LogoPreview({ url, alt }: { url: string; alt: string }) {
  const ok = url.trim() !== '' && !url.includes('airtableusercontent.com');
  return (
    <div className="flex h-16 w-full items-center justify-center overflow-hidden rounded-md border border-border bg-muted/30">
      {ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} className="max-h-full max-w-full object-contain" />
      ) : (
        <span className="text-xs text-muted-foreground">
          {url.trim() === '' ? 'No logo set' : 'Stale image — replace URL'}
        </span>
      )}
    </div>
  );
}

const PREVIEW_TYPES = ['community', 'qmi', 'floorplan'] as const;
type PreviewType = (typeof PREVIEW_TYPES)[number];

const TYPE_LABELS: Record<PreviewType, string> = {
  community: 'Community',
  qmi: 'QMI',
  floorplan: 'Floor plan',
};

export function PdfThemeEditor({
  draftJson,
  draftVersion,
  activeVersion,
  samples,
  userEmail,
}: Props) {
  const [theme, setTheme] = useState<Theme>(() => parseTheme(draftJson));
  const [nonce, setNonce] = useState(0);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [currentDraftVersion, setCurrentDraftVersion] = useState(draftVersion);

  // Preview pane state.
  const [previewType, setPreviewType] = useState<PreviewType>('community');
  const firstByType = useCallback(
    (t: PreviewType) => samples.find((s) => s.type === t)?.slug ?? '',
    [samples]
  );
  const [previewSlug, setPreviewSlug] = useState<string>(() => firstByType('community'));

  // Debounce timer ref for auto-save.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When previewType changes, reset slug to the first matching sample.
  useEffect(() => {
    setPreviewSlug(firstByType(previewType));
  }, [previewType, firstByType]);

  const samplesForType = (t: PreviewType) => samples.filter((s) => s.type === t);

  // ── theme update helper ────────────────────────────────────────────────────
  function update(next: Theme) {
    setTheme(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        try {
          await saveDraftTheme(JSON.stringify(next));
          setNonce((n) => n + 1);
          setMsg('Draft saved');
        } catch {
          setMsg('Error saving draft');
        }
      });
    }, 500);
  }

  // Helpers to update nested paths without losing type safety.
  function setBrandColor(key: keyof Theme['brand']['colors'], value: string) {
    update({ ...theme, brand: { ...theme.brand, colors: { ...theme.brand.colors, [key]: value } } });
  }
  function setBrand(key: keyof Omit<Theme['brand'], 'colors'>, value: string) {
    update({ ...theme, brand: { ...theme.brand, [key]: value } });
  }
  function setFooter(key: keyof Theme['footer'], value: string | boolean) {
    update({ ...theme, footer: { ...theme.footer, [key]: value } });
  }
  function setQmi(key: keyof Theme['qmi'], value: boolean) {
    update({ ...theme, qmi: { ...theme.qmi, [key]: value } });
  }
  function setDisclaimer(key: keyof Theme['disclaimers'], value: string) {
    update({ ...theme, disclaimers: { ...theme.disclaimers, [key]: value } });
  }
  function setCopy(key: keyof Theme['copy'], value: string) {
    update({ ...theme, copy: { ...theme.copy, [key]: value } });
  }

  // ── action bar handlers ────────────────────────────────────────────────────
  function doSaveNow() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    startTransition(async () => {
      try {
        await saveDraftTheme(JSON.stringify(theme));
        setNonce((n) => n + 1);
        setMsg('Draft saved');
      } catch {
        setMsg('Error saving draft');
      }
    });
  }

  function doRevert() {
    startTransition(async () => {
      try {
        await revertDraftTheme();
        // The server revalidated; reload the page to pull the fresh draft JSON.
        window.location.reload();
      } catch {
        setMsg('Error reverting draft');
      }
    });
  }

  function doPublish() {
    setConfirmPublish(false);
    startTransition(async () => {
      try {
        const newVersion = await publishTheme();
        setCurrentDraftVersion(newVersion);
        setNonce((n) => n + 1);
        setMsg(`Published v${newVersion}`);
      } catch {
        setMsg('Error publishing theme');
      }
    });
  }

  const isError = msg != null && msg.startsWith('Error');
  const previewSrc =
    previewSlug
      ? `/api/pdf-preview/${previewType}/${encodeURIComponent(previewSlug)}?theme=draft&v=${nonce}`
      : null;

  return (
    <div className="flex w-full flex-col gap-5">
      {/* ── Header / action bar ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Settings</p>
          <h1 className="font-heading text-2xl font-bold text-foreground">PDF Theme</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Edit the brand theme for all generated PDFs. Changes auto-save to the draft. Publish
            when ready — all PDFs re-render on next access.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {msg ? (
            <Badge variant={isError ? 'destructive' : 'secondary'} className="h-5">
              {msg}
            </Badge>
          ) : null}
          <Badge variant="outline" className="h-5 text-xs">
            Draft v{currentDraftVersion}
          </Badge>
          <Badge variant="outline" className="h-5 text-xs text-muted-foreground">
            Active v{activeVersion}
          </Badge>
          <Button variant="outline" size="sm" onClick={doRevert} disabled={pending}>
            Revert
          </Button>
          <Button variant="outline" size="sm" onClick={doSaveNow} disabled={pending}>
            Save draft
          </Button>
          <Button size="sm" onClick={() => setConfirmPublish(true)} disabled={pending}>
            Publish theme
          </Button>
        </div>
      </div>

      {/* ── Two-pane layout ─────────────────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-[1fr_minmax(24rem,32rem)]">
        {/* LEFT: controls */}
        <div className="flex flex-col gap-4 self-start">
          {/* Brand colors */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Brand colors</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 pt-4 sm:grid-cols-2">
              {(
                [
                  ['primary', 'Primary'],
                  ['accent', 'Accent'],
                  ['neutral', 'Neutral'],
                  ['ink', 'Ink (body text)'],
                  ['pageBg', 'Page background'],
                  ['bandText', 'Band text'],
                ] as [keyof Theme['brand']['colors'], string][]
              ).map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <input
                    type="color"
                    id={`color-${key}`}
                    value={theme.brand.colors[key]}
                    onChange={(e) => setBrandColor(key, e.target.value)}
                    className="h-8 w-10 cursor-pointer rounded border border-input bg-background p-0.5"
                  />
                  <Label htmlFor={`color-${key}`} className="text-sm">
                    {label}
                  </Label>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {theme.brand.colors[key]}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Fonts */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Fonts</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 pt-4 sm:grid-cols-3">
              {(
                [
                  ['fontHeading', 'Heading'],
                  ['fontBody', 'Body'],
                  ['fontLabel', 'Label'],
                ] as [keyof Omit<Theme['brand'], 'colors'>, string][]
              ).map(([key, label]) => (
                <div key={key} className="grid gap-1">
                  <Label htmlFor={`font-${key}`} className="text-xs text-muted-foreground">
                    {label}
                  </Label>
                  <Input
                    id={`font-${key}`}
                    value={(theme.brand as unknown as Record<string, string>)[key] ?? ''}
                    onChange={(e) => setBrand(key, e.target.value)}
                    placeholder="e.g. Inter"
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Logos — each shows the IMAGE (live preview) above its URL input so the
              operator never works from a bare URL. The URL field stays (this settings
              form stores an external URL; the DAM upload widget is a Phase-C follow-up). */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Logos</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 pt-4">
              <div className="grid gap-1">
                <Label htmlFor="logo-wordmark" className="text-xs text-muted-foreground">
                  Wordmark
                </Label>
                <LogoPreview url={theme.brand.logoWordmarkUrl ?? ''} alt="Wordmark logo" />
                <Input
                  id="logo-wordmark"
                  value={theme.brand.logoWordmarkUrl ?? ''}
                  onChange={(e) => setBrand('logoWordmarkUrl', e.target.value)}
                  placeholder="https://…/wordmark.png"
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="logo-monogram" className="text-xs text-muted-foreground">
                  Monogram
                </Label>
                <LogoPreview url={theme.brand.logoMonogramUrl ?? ''} alt="Monogram logo" />
                <Input
                  id="logo-monogram"
                  value={theme.brand.logoMonogramUrl ?? ''}
                  onChange={(e) => setBrand('logoMonogramUrl', e.target.value)}
                  placeholder="https://…/monogram.png"
                />
              </div>
            </CardContent>
          </Card>

          {/* Footer */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Footer</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 pt-4">
              <div className="grid gap-1">
                <Label htmlFor="footer-website" className="text-xs text-muted-foreground">
                  Website
                </Label>
                <Input
                  id="footer-website"
                  value={theme.footer.website}
                  onChange={(e) => setFooter('website', e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="footer-phone" className="text-xs text-muted-foreground">
                  Phone
                </Label>
                <Input
                  id="footer-phone"
                  value={theme.footer.phone}
                  onChange={(e) => setFooter('phone', e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="footer-hours" className="text-xs text-muted-foreground">
                  Sales hours
                </Label>
                <Input
                  id="footer-hours"
                  value={theme.footer.salesHours}
                  onChange={(e) => setFooter('salesHours', e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="footer-equalhousing"
                  checked={theme.footer.showEqualHousingLogo}
                  onCheckedChange={(v) => setFooter('showEqualHousingLogo', v)}
                />
                <Label htmlFor="footer-equalhousing" className="text-sm">
                  Show Equal Housing logo
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* QMI options */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle>QMI options</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="qmi-appendfloorplan"
                  checked={theme.qmi.appendFloorPlanPages}
                  onCheckedChange={(v) => setQmi('appendFloorPlanPages', v)}
                />
                <Label htmlFor="qmi-appendfloorplan" className="text-sm">
                  Append floor-plan pages to QMI PDF
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* Disclaimers */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Disclaimers</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 pt-4">
              {(
                [
                  ['community', 'Community brochure'],
                  ['qmi', 'QMI spec sheet'],
                  ['floorplan', 'Floor plan'],
                  ['list', 'Community list'],
                ] as [keyof Theme['disclaimers'], string][]
              ).map(([key, label]) => (
                <div key={key} className="grid gap-1">
                  <Label htmlFor={`disclaimer-${key}`} className="text-xs text-muted-foreground">
                    {label}
                  </Label>
                  <Textarea
                    id={`disclaimer-${key}`}
                    value={theme.disclaimers[key]}
                    onChange={(e) => setDisclaimer(key, e.target.value)}
                    rows={2}
                    placeholder="Leave blank to omit."
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Copy — Esperanza Difference */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle>The Esperanza Difference</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {/* TODO Phase C: replace with RichTextField widget */}
              <div className="grid gap-1">
                <Label htmlFor="copy-esperanza" className="text-xs text-muted-foreground">
                  Body copy (plain text — rich-text widget coming in Phase C)
                </Label>
                <Textarea
                  id="copy-esperanza"
                  value={theme.copy.esperanzaDifference}
                  onChange={(e) => setCopy('esperanzaDifference', e.target.value)}
                  rows={5}
                  placeholder="Why Esperanza…"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: live preview */}
        <Card className="self-start">
          <CardHeader className="border-b">
            <CardTitle>Live preview</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <Tabs
              value={previewType}
              onValueChange={(v) => setPreviewType(v as PreviewType)}
              className="gap-3"
            >
              <TabsList>
                {PREVIEW_TYPES.map((t) => (
                  <TabsTrigger key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </TabsTrigger>
                ))}
              </TabsList>

              {PREVIEW_TYPES.map((t) => (
                <TabsContent key={t} value={t}>
                  {samplesForType(t).length > 1 ? (
                    <div className="mb-2">
                      <Select value={previewSlug} onValueChange={(v) => v && setPreviewSlug(v)}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select a sample…" />
                        </SelectTrigger>
                        <SelectContent>
                          {samplesForType(t).map((s) => (
                            <SelectItem key={s.slug} value={s.slug}>
                              {s.slug}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                    </div>
                  ) : null}

                  {previewSrc ? (
                    <iframe
                      key={`${t}-${nonce}`}
                      src={previewSrc}
                      title={`PDF preview — ${TYPE_LABELS[t]}`}
                      className="w-full rounded border border-border"
                      style={{ height: 600 }}
                    />
                  ) : (
                    <div className="flex h-60 items-center justify-center rounded border border-border text-sm text-muted-foreground">
                      No sample slugs available. Build some PDFs first.
                    </div>
                  )}

                  <p className="mt-2 text-xs text-muted-foreground">
                    Updates as you edit (≈500 ms debounce). Renders against the deployed pdf
                    worker — live only after deploy.
                  </p>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* ── Publish confirmation dialog ─────────────────────────────────────── */}
      <Dialog open={confirmPublish} onOpenChange={(o) => !o && setConfirmPublish(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish theme?</DialogTitle>
            <DialogDescription>
              This will copy the draft (v{currentDraftVersion}) into the active theme. All PDFs
              will be marked stale and re-rendered on the next request. This cannot be undone
              without rolling back to a previous version.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmPublish(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button onClick={doPublish} disabled={pending}>
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
