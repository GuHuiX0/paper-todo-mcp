using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;

namespace PaperTodoDesktop
{
    internal interface IPaperRowHost
    {
        PaperPalette Palette { get; }
        int? EditingId { get; }
        void OnToggleDone(int id);
        void OnToggleEdit(int id);
        void OnQuickStatus(int id, string status);
        void OnDelete(int id);
        void OnSaveEdit(int id, Dictionary<string, object> payload);
        void OnCancelEdit();
    }

    internal static class PaperRowBuilder
    {
        public static UIElement BuildSectionHeading(string title, int count, Brush color, PaperPalette palette, bool isFirst)
        {
            Border wrap = new Border();
            wrap.BorderBrush = palette.RuleLine;
            wrap.BorderThickness = new Thickness(0, 0, 0, 1);
            wrap.Padding = new Thickness(0, isFirst ? 4 : 14, 0, 5);

            StackPanel sp = new StackPanel();
            sp.Orientation = Orientation.Horizontal;

            TextBlock lbl = new TextBlock();
            lbl.Text = title.ToUpperInvariant();
            lbl.FontFamily = PaperPalette.SerifFont;
            lbl.FontSize = 11.2;
            lbl.FontWeight = FontWeights.SemiBold;
            lbl.Foreground = color;
            lbl.VerticalAlignment = VerticalAlignment.Center;

            TextBlock cnt = new TextBlock();
            cnt.Text = count.ToString();
            cnt.FontFamily = PaperPalette.MonoFont;
            cnt.FontSize = 10.5;
            cnt.Foreground = color;
            cnt.Opacity = 0.72;
            cnt.Margin = new Thickness(7, 0, 0, 0);
            cnt.VerticalAlignment = VerticalAlignment.Center;

            sp.Children.Add(lbl);
            sp.Children.Add(cnt);
            wrap.Child = sp;
            return wrap;
        }

        public static UIElement BuildRow(TodoItem item, bool isFresh, IPaperRowHost host)
        {
            PaperPalette palette = host.Palette;
            bool isDone = item.status == "done";
            bool isWaiting = item.status == "waiting";
            bool isInbox = item.status == "inbox";
            bool isHigh = item.priority == "high";
            bool isEditing = host.EditingId.HasValue && host.EditingId.Value == item.id;

            Border outer = new Border();
            outer.BorderBrush = palette.RuleLine;
            outer.BorderThickness = new Thickness(0, 0, 0, 1);
            SolidColorBrush rowBg = new SolidColorBrush(Colors.Transparent);
            outer.Background = rowBg;

            if (isFresh)
            {
                ColorAnimation flash = new ColorAnimation();
                flash.From = palette.PaperFlashColor;
                flash.To = Colors.Transparent;
                flash.Duration = new Duration(TimeSpan.FromMilliseconds(1300));
                flash.EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut };
                rowBg.BeginAnimation(SolidColorBrush.ColorProperty, flash);
            }

            StackPanel container = new StackPanel();

            Grid line = new Grid();
            line.Margin = new Thickness(2, 9, 2, 9);
            line.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            line.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            line.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            // Hand-drawn-feel paper checkbox
            Border checkBox = new Border();
            checkBox.Width = 16;
            checkBox.Height = 16;
            checkBox.CornerRadius = new CornerRadius(3);
            checkBox.BorderThickness = new Thickness(1.4);
            checkBox.BorderBrush = isDone
                ? palette.InkMuted
                : (isHigh ? palette.Accent : palette.InkSecondary);
            checkBox.Background = isDone ? palette.PaperElevated : Brushes.Transparent;
            checkBox.VerticalAlignment = VerticalAlignment.Top;
            checkBox.Margin = new Thickness(0, 2, 10, 0);
            checkBox.Cursor = Cursors.Hand;
            checkBox.ToolTip = isDone ? "Reopen task" : "Mark as done";

            if (isDone)
            {
                Path checkPath = UiHelpers.MakeIcon(UiHelpers.ICON_CHECK, palette.InkMuted, 10, 1.9);
                checkPath.HorizontalAlignment = HorizontalAlignment.Center;
                checkPath.VerticalAlignment = VerticalAlignment.Center;
                checkBox.Child = checkPath;
            }

            int capturedId = item.id;
            checkBox.MouseLeftButtonUp += delegate(object s, MouseButtonEventArgs e)
            {
                e.Handled = true;
                host.OnToggleDone(capturedId);
            };
            Grid.SetColumn(checkBox, 0);
            line.Children.Add(checkBox);

            // Body (title + notes + marginalia)
            StackPanel body = new StackPanel();
            body.Cursor = Cursors.Hand;
            body.Background = Brushes.Transparent;
            body.MouseLeftButtonUp += delegate(object s, MouseButtonEventArgs e)
            {
                e.Handled = true;
                host.OnToggleEdit(capturedId);
            };

            WrapPanel titleWrap = new WrapPanel();
            if (isHigh && !isDone)
            {
                TextBlock bang = new TextBlock();
                bang.Text = "!";
                bang.FontFamily = PaperPalette.MonoFont;
                bang.FontSize = 13;
                bang.FontWeight = FontWeights.Bold;
                bang.Foreground = palette.Accent;
                bang.Margin = new Thickness(0, 0, 6, 0);
                titleWrap.Children.Add(bang);
            }

            TextBlock titleTb = new TextBlock();
            titleTb.Text = item.title ?? "";
            titleTb.FontFamily = PaperPalette.SansFont;
            titleTb.FontSize = 13.4;
            titleTb.TextWrapping = TextWrapping.Wrap;
            titleTb.Foreground = isDone ? palette.InkMuted : (isWaiting ? palette.InkSecondary : palette.InkPrimary);
            if (isDone)
            {
                titleTb.TextDecorations = TextDecorations.Strikethrough;
            }
            titleWrap.Children.Add(titleTb);
            body.Children.Add(titleWrap);

            if (!string.IsNullOrEmpty(item.notes))
            {
                TextBlock notesTb = new TextBlock();
                notesTb.Text = item.notes;
                notesTb.FontFamily = PaperPalette.SansFont;
                notesTb.FontSize = 12;
                notesTb.Foreground = isDone ? palette.InkMuted : palette.InkSecondary;
                notesTb.TextWrapping = TextWrapping.Wrap;
                notesTb.Margin = new Thickness(0, 2, 0, 0);
                body.Children.Add(notesTb);
            }

            WrapPanel metaWrap = new WrapPanel();
            metaWrap.Margin = new Thickness(0, 4, 0, 0);

            if (!string.IsNullOrEmpty(item.person))
            {
                TextBlock p = new TextBlock();
                p.Text = "@" + item.person;
                p.FontFamily = PaperPalette.MonoFont;
                p.FontSize = 11;
                p.Foreground = palette.InkSecondary;
                p.Margin = new Thickness(0, 0, 9, 0);
                metaWrap.Children.Add(p);
            }

            if (!string.IsNullOrEmpty(item.due))
            {
                TextBlock d = new TextBlock();
                d.Text = item.due;
                d.FontFamily = PaperPalette.MonoFont;
                d.FontSize = 11;
                d.Foreground = palette.InkSecondary;
                d.Margin = new Thickness(0, 0, 9, 0);
                metaWrap.Children.Add(d);
            }

            if (item.source == "teams" || item.source == "outlook" || item.source == "agent")
            {
                Border badge = new Border();
                badge.CornerRadius = new CornerRadius(2);
                badge.BorderThickness = new Thickness(1);
                badge.Padding = new Thickness(4, 0, 4, 0);
                badge.Margin = new Thickness(0, 0, 9, 0);

                Brush fg = palette.InkMuted;
                Brush bd = palette.RuleLine;
                string label = "AI";
                if (item.source == "teams")
                {
                    fg = palette.Inbox;
                    bd = palette.InboxSoft;
                    label = "TEAMS";
                }
                else if (item.source == "outlook")
                {
                    fg = palette.Waiting;
                    bd = palette.WaitingSoft;
                    label = "OUTLOOK";
                }
                badge.BorderBrush = bd;

                TextBlock srcTb = new TextBlock();
                srcTb.Text = label;
                srcTb.FontFamily = PaperPalette.MonoFont;
                srcTb.FontSize = 9.5;
                srcTb.Foreground = fg;
                badge.Child = srcTb;
                metaWrap.Children.Add(badge);
            }

            if (!string.IsNullOrEmpty(item.sourceUrl) &&
                (item.sourceUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                 item.sourceUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase)))
            {
                string targetUrl = item.sourceUrl;
                TextBlock linkTb = new TextBlock();
                linkTb.Text = "Source \u2197";
                linkTb.FontFamily = PaperPalette.MonoFont;
                linkTb.FontSize = 10.5;
                linkTb.Foreground = palette.Inbox;
                linkTb.TextDecorations = TextDecorations.Underline;
                linkTb.Cursor = Cursors.Hand;
                linkTb.Margin = new Thickness(0, 0, 9, 0);
                linkTb.MouseLeftButtonUp += delegate(object s, MouseButtonEventArgs e)
                {
                    e.Handled = true;
                    try
                    {
                        Process.Start(new ProcessStartInfo(targetUrl) { UseShellExecute = true });
                    }
                    catch { }
                };
                metaWrap.Children.Add(linkTb);
            }

            TextBlock idTb = new TextBlock();
            idTb.Text = "#" + item.id;
            idTb.FontFamily = PaperPalette.MonoFont;
            idTb.FontSize = 10.5;
            idTb.Foreground = palette.InkMuted;
            idTb.Opacity = 0.0;
            metaWrap.Children.Add(idTb);

            if (metaWrap.Children.Count > 0)
            {
                body.Children.Add(metaWrap);
            }

            Grid.SetColumn(body, 1);
            line.Children.Add(body);

            // Hover quick actions
            StackPanel actions = new StackPanel();
            actions.Orientation = Orientation.Horizontal;
            actions.VerticalAlignment = VerticalAlignment.Top;
            actions.Margin = new Thickness(8, 0, 0, 0);
            actions.Opacity = (isInbox || isEditing) ? 1.0 : 0.0;

            if (isInbox)
            {
                actions.Children.Add(MakeActionBtn("Accept", palette.InkPrimary, palette.RuleStrong, palette, delegate { host.OnQuickStatus(capturedId, "todo"); }));
                actions.Children.Add(MakeActionBtn("Dismiss", palette.Accent, null, palette, delegate { host.OnDelete(capturedId); }));
            }
            else if (!isDone)
            {
                bool isFocus = item.status == "now";
                actions.Children.Add(MakeActionBtn("Focus", isFocus ? palette.Accent : palette.InkMuted, null, palette, delegate
                {
                    host.OnQuickStatus(capturedId, isFocus ? "todo" : "now");
                }));
                actions.Children.Add(MakeActionBtn("Wait", isWaiting ? palette.Waiting : palette.InkMuted, null, palette, delegate
                {
                    host.OnQuickStatus(capturedId, isWaiting ? "todo" : "waiting");
                }));
                actions.Children.Add(MakeActionBtn("\u00D7", palette.InkMuted, null, palette, delegate { host.OnDelete(capturedId); }));
            }
            else
            {
                actions.Children.Add(MakeActionBtn("\u00D7", palette.InkMuted, null, palette, delegate { host.OnDelete(capturedId); }));
            }

            Grid.SetColumn(actions, 2);
            line.Children.Add(actions);

            container.Children.Add(line);

            if (isEditing)
            {
                container.Children.Add(BuildEditorDrawer(item, host));
            }

            outer.Child = container;

            outer.MouseEnter += delegate
            {
                if (!isEditing) outer.Background = palette.PaperHover;
                actions.Opacity = 1.0;
                idTb.Opacity = 0.65;
            };
            outer.MouseLeave += delegate
            {
                if (!isEditing) outer.Background = rowBg;
                if (!isInbox && !isEditing) actions.Opacity = 0.0;
                idTb.Opacity = 0.0;
            };

            return outer;
        }

        private static Button MakeActionBtn(string text, Brush fg, Brush border, PaperPalette palette, Action onClick)
        {
            TextBlock tb = new TextBlock();
            tb.Text = text;
            tb.FontFamily = PaperPalette.MonoFont;
            tb.FontSize = 10.5;
            tb.Foreground = fg;

            Button btn = UiHelpers.MakeFlatButton(
                tb,
                palette,
                text,
                new Thickness(5, 2, 5, 2),
                3,
                border,
                Brushes.Transparent,
                palette.PaperElevated
            );
            btn.Margin = new Thickness(2, 0, 0, 0);
            btn.Click += delegate(object s, RoutedEventArgs e)
            {
                e.Handled = true;
                onClick();
            };
            return btn;
        }

        private static UIElement BuildEditorDrawer(TodoItem item, IPaperRowHost host)
        {
            PaperPalette palette = host.Palette;

            Border drawer = new Border();
            drawer.Background = palette.PaperElevated;
            drawer.BorderBrush = palette.RuleLine;
            drawer.BorderThickness = new Thickness(0, 1, 0, 0);
            drawer.Padding = new Thickness(26, 10, 10, 12);

            StackPanel sp = new StackPanel();

            Border titleBorder = MakeFieldBox(palette);
            TextBox titleTb;
            TextBlock titlePh;
            titleBorder.Child = UiHelpers.MakePlaceholderTextBox("Task title", palette, 13, false, out titleTb, out titlePh);
            titleTb.Text = item.title ?? "";
            sp.Children.Add(titleBorder);

            Border notesBorder = MakeFieldBox(palette);
            notesBorder.Margin = new Thickness(0, 7, 0, 0);
            TextBox notesTb;
            TextBlock notesPh;
            notesBorder.Child = UiHelpers.MakePlaceholderTextBox("Notes, context, or next action…", palette, 12.2, true, out notesTb, out notesPh);
            notesTb.Text = item.notes ?? "";
            sp.Children.Add(notesBorder);

            string selectedStatus = item.status ?? "todo";
            WrapPanel statusRow = new WrapPanel();
            statusRow.Margin = new Thickness(0, 8, 0, 0);

            string[] statusKeys = new string[] { "now", "todo", "waiting", "inbox", "done" };
            string[] statusLabels = new string[] { "Focus", "Todo", "Waiting", "Inbox", "Done" };
            List<Button> statusBtns = new List<Button>();

            Action refreshStatusBtns = delegate
            {
                for (int i = 0; i < statusBtns.Count; i++)
                {
                    bool active = statusKeys[i] == selectedStatus;
                    Button b = statusBtns[i];
                    b.BorderBrush = active ? palette.InkPrimary : palette.RuleLine;
                    b.Background = active ? palette.PaperBg : Brushes.Transparent;
                    TextBlock t = b.Content as TextBlock;
                    if (t != null)
                    {
                        t.Foreground = active ? palette.InkPrimary : palette.InkSecondary;
                        t.FontWeight = active ? FontWeights.SemiBold : FontWeights.Normal;
                    }
                }
            };

            for (int i = 0; i < statusKeys.Length; i++)
            {
                string key = statusKeys[i];
                TextBlock t = new TextBlock();
                t.Text = statusLabels[i];
                t.FontFamily = PaperPalette.SansFont;
                t.FontSize = 11.5;
                Button b = UiHelpers.MakeFlatButton(t, palette, statusLabels[i], new Thickness(7, 2, 7, 2), 3, palette.RuleLine, Brushes.Transparent, palette.PaperHover);
                b.Margin = new Thickness(0, 0, 5, 4);
                b.Click += delegate
                {
                    selectedStatus = key;
                    refreshStatusBtns();
                };
                statusBtns.Add(b);
                statusRow.Children.Add(b);
            }
            refreshStatusBtns();
            sp.Children.Add(statusRow);

            WrapPanel metaRow = new WrapPanel();
            metaRow.Margin = new Thickness(0, 6, 0, 0);

            TextBox personTb;
            metaRow.Children.Add(MakeInlineInput("Person", "Alex", item.person ?? "", 88, palette, out personTb));

            TextBox dueTb;
            metaRow.Children.Add(MakeInlineInput("Due", "Today 5pm", item.due ?? "", 96, palette, out dueTb));

            bool isUrgent = item.priority == "high";
            TextBlock prioText = new TextBlock();
            prioText.Text = "! Urgent";
            prioText.FontFamily = PaperPalette.MonoFont;
            prioText.FontSize = 11;

            Button prioBtn = UiHelpers.MakeFlatButton(prioText, palette, "Toggle urgent", new Thickness(7, 3, 7, 3), 3, palette.RuleStrong, Brushes.Transparent, palette.PaperHover);
            prioBtn.Margin = new Thickness(4, 2, 0, 0);

            Action refreshPrio = delegate
            {
                prioBtn.BorderBrush = isUrgent ? palette.Accent : palette.RuleStrong;
                prioBtn.Background = isUrgent ? palette.AccentSoft : Brushes.Transparent;
                prioText.Foreground = isUrgent ? palette.Accent : palette.InkSecondary;
                prioText.FontWeight = isUrgent ? FontWeights.Bold : FontWeights.Normal;
            };
            refreshPrio();
            prioBtn.Click += delegate
            {
                isUrgent = !isUrgent;
                refreshPrio();
            };
            metaRow.Children.Add(prioBtn);
            sp.Children.Add(metaRow);

            StackPanel footer = new StackPanel();
            footer.Orientation = Orientation.Horizontal;
            footer.HorizontalAlignment = HorizontalAlignment.Right;
            footer.Margin = new Thickness(0, 10, 0, 0);

            TextBlock cancelLbl = new TextBlock { Text = "Cancel", FontFamily = PaperPalette.SansFont, FontSize = 12, Foreground = palette.InkSecondary };
            Button cancelBtn = UiHelpers.MakeFlatButton(cancelLbl, palette, "Cancel (Esc)", new Thickness(10, 4, 10, 4), 4, palette.RuleStrong, Brushes.Transparent, palette.PaperHover);
            cancelBtn.Click += delegate { host.OnCancelEdit(); };

            TextBlock saveLbl = new TextBlock { Text = "Save", FontFamily = PaperPalette.SansFont, FontSize = 12, Foreground = palette.PaperBg };
            Button saveBtn = UiHelpers.MakeFlatButton(saveLbl, palette, "Save (Enter)", new Thickness(12, 4, 12, 4), 4, palette.InkPrimary, palette.InkPrimary, palette.InkSecondary);
            saveBtn.Margin = new Thickness(7, 0, 0, 0);

            int capturedId = item.id;
            Action commit = delegate
            {
                string t = (titleTb.Text ?? "").Trim();
                if (string.IsNullOrEmpty(t))
                {
                    titleTb.Focus();
                    return;
                }
                Dictionary<string, object> payload = new Dictionary<string, object>();
                payload["title"] = t;
                payload["notes"] = (notesTb.Text ?? "").Trim();
                payload["status"] = selectedStatus;
                payload["priority"] = isUrgent ? "high" : "normal";
                payload["person"] = (personTb.Text ?? "").Trim();
                payload["due"] = (dueTb.Text ?? "").Trim();
                host.OnSaveEdit(capturedId, payload);
            };

            saveBtn.Click += delegate { commit(); };
            titleTb.KeyDown += delegate(object s, KeyEventArgs e)
            {
                if (e.Key == Key.Enter)
                {
                    e.Handled = true;
                    commit();
                }
                else if (e.Key == Key.Escape)
                {
                    e.Handled = true;
                    host.OnCancelEdit();
                }
            };
            drawer.KeyDown += delegate(object s, KeyEventArgs e)
            {
                if (e.Key == Key.Escape)
                {
                    e.Handled = true;
                    host.OnCancelEdit();
                }
            };

            footer.Children.Add(cancelBtn);
            footer.Children.Add(saveBtn);
            sp.Children.Add(footer);

            drawer.Child = sp;

            drawer.Loaded += delegate
            {
                titleTb.Focus();
                titleTb.CaretIndex = titleTb.Text.Length;
            };
            return drawer;
        }

        private static Border MakeFieldBox(PaperPalette palette)
        {
            Border b = new Border();
            b.Background = palette.PaperBg;
            b.BorderBrush = palette.RuleStrong;
            b.BorderThickness = new Thickness(1);
            b.CornerRadius = new CornerRadius(4);
            b.Padding = new Thickness(6, 3, 6, 3);
            return b;
        }

        private static UIElement MakeInlineInput(string label, string placeholder, string value, double width, PaperPalette palette, out TextBox textBox)
        {
            StackPanel sp = new StackPanel();
            sp.Orientation = Orientation.Horizontal;
            sp.Margin = new Thickness(0, 2, 10, 2);

            TextBlock lbl = new TextBlock();
            lbl.Text = label;
            lbl.FontFamily = PaperPalette.SansFont;
            lbl.FontSize = 11.2;
            lbl.Foreground = palette.InkMuted;
            lbl.VerticalAlignment = VerticalAlignment.Center;
            lbl.Margin = new Thickness(0, 0, 5, 0);

            Border underline = new Border();
            underline.BorderBrush = palette.RuleStrong;
            underline.BorderThickness = new Thickness(0, 0, 0, 1);
            underline.Width = width;

            TextBlock ph;
            underline.Child = UiHelpers.MakePlaceholderTextBox(placeholder, palette, 11.8, false, out textBox, out ph);
            textBox.Text = value;

            sp.Children.Add(lbl);
            sp.Children.Add(underline);
            return sp;
        }
    }
}
