using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Shell;
using System.Windows.Threading;

namespace PaperTodoDesktop
{
    public sealed class PaperWindow : Window, IPaperRowHost
    {
        private readonly PaperTodoApiClient _api;
        private readonly DispatcherTimer _pollTimer;
        private readonly DispatcherTimer _toastTimer;
        private readonly Dictionary<int, string> _prevSignatures = new Dictionary<int, string>();
        private readonly HashSet<int> _freshIds = new HashSet<int>();

        private PaperPalette _palette;
        private bool _isDark = false;
        private bool _allowExit = false;
        private bool _bootstrapped = false;
        private bool _pollInFlight = false;
        private bool _mutationInFlight = false;

        private int _revision = 0;
        private List<TodoItem> _todos = new List<TodoItem>();
        private TodoCounts _counts = new TodoCounts();
        private List<string> _people = new List<string>();

        private string _activeTab = "active";
        private string _selectedPerson = "";
        private int? _editingId = null;

        private string _composerStatusValue = "todo";
        private bool _composerUrgent = false;
        private string _draftTitle = "";
        private string _draftPerson = "";
        private string _draftDue = "";
        private bool _composerExtrasOpen = false;

        // Tray
        private System.Drawing.Icon _trayGdiIcon;
        private System.Windows.Forms.NotifyIcon _trayIcon;
        private System.Windows.Forms.ContextMenuStrip _trayMenu;
        private System.Windows.Forms.ToolStripMenuItem _trayPinItem;

        // Dynamic UI refs rebuilt on theme switch
        private Grid _rootGrid;
        private Ellipse _syncDot;
        private TextBlock _syncLabel;
        private Button _pinBtn;
        private Path _pinPath;
        private StackPanel _tabsRow;
        private Border _peopleBarBorder;
        private WrapPanel _peoplePanel;
        private Border _composerBox;
        private TextBox _composerInput;
        private StackPanel _composerExtras;
        private TextBox _composerPersonInput;
        private TextBox _composerDueInput;
        private Button _composerUrgentBtn;
        private TextBlock _composerUrgentText;
        private List<Button> _composerStatusBtns = new List<Button>();
        private StackPanel _listStack;
        private TextBlock _footerStats;
        private Button _clearDoneBtn;
        private Border _toastBorder;
        private TextBlock _toastLabel;

        public PaperWindow(int port, string dataDir, string serverScript)
        {
            _api = new PaperTodoApiClient(port, dataDir, serverScript);
            _palette = PaperPalette.Light();

            Title = "Paper Todo";
            Width = 448;
            Height = 680;
            MinWidth = 360;
            MinHeight = 460;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.CanResize;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            UseLayoutRounding = true;
            SnapsToDevicePixels = true;
            Background = _palette.PaperBg;

            TextOptions.SetTextFormattingMode(this, TextFormattingMode.Ideal);
            TextOptions.SetTextRenderingMode(this, TextRenderingMode.ClearType);

            WindowChrome chrome = new WindowChrome();
            chrome.CaptionHeight = 36;
            chrome.ResizeBorderThickness = new Thickness(6);
            chrome.GlassFrameThickness = new Thickness(1);
            chrome.CornerRadius = new CornerRadius(8);
            WindowChrome.SetWindowChrome(this, chrome);

            _pollTimer = new DispatcherTimer();
            _pollTimer.Interval = TimeSpan.FromMilliseconds(1200);
            _pollTimer.Tick += async delegate
            {
                await PollBoardAsync(false);
            };

            _toastTimer = new DispatcherTimer();
            _toastTimer.Interval = TimeSpan.FromMilliseconds(2400);
            _toastTimer.Tick += delegate
            {
                _toastTimer.Stop();
                if (_toastBorder != null)
                {
                    _toastBorder.Visibility = Visibility.Collapsed;
                }
            };

            SetupTray();
            BuildLayout();

            SourceInitialized += OnSourceInitialized;
            Loaded += OnLoaded;
            Closing += OnWindowClosing;
            Closed += OnWindowClosed;
            PreviewKeyDown += OnWindowPreviewKeyDown;
            PreviewMouseDown += OnWindowPreviewMouseDown;
        }

        public PaperPalette Palette
        {
            get { return _palette; }
        }

        public int? EditingId
        {
            get { return _editingId; }
        }

        public void SummonFromExternal()
        {
            NativeInterop.BringWindowToFront(this);
            if (_composerInput != null)
            {
                _composerInput.Focus();
            }
            Task ignored = PollBoardAsync(true);
        }

        private void OnSourceInitialized(object sender, EventArgs e)
        {
            NativeInterop.ApplyWindows11Polish(this, _isDark);
            HwndSource source = PresentationSource.FromVisual(this) as HwndSource;
            if (source != null)
            {
                source.AddHook(WndProcHook);
                NativeInterop.RegisterHotKey(
                    source.Handle,
                    NativeInterop.HOTKEY_ID_TOGGLE,
                    NativeInterop.MOD_ALT | NativeInterop.MOD_SHIFT | NativeInterop.MOD_NOREPEAT,
                    NativeInterop.VK_T
                );
            }
        }

        private IntPtr WndProcHook(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
        {
            if (msg == NativeInterop.WM_HOTKEY && wParam.ToInt32() == NativeInterop.HOTKEY_ID_TOGGLE)
            {
                ToggleVisibilityAndFocus();
                handled = true;
            }
            return IntPtr.Zero;
        }

        private void ToggleVisibilityAndFocus()
        {
            if (IsVisible && WindowState != WindowState.Minimized && IsActive)
            {
                Hide();
                return;
            }
            SummonFromExternal();
        }

        private async void OnLoaded(object sender, RoutedEventArgs e)
        {
            if (_bootstrapped) return;
            _bootstrapped = true;
            NativeInterop.BringWindowToFront(this);

            SetSyncStatus(false, false, "Starting…");
            bool ready = await _api.EnsureBackendAsync();
            if (ready)
            {
                await LoadBoardAsync(false);
            }
            else
            {
                SetSyncStatus(false, false, "Offline");
                ShowToast("Could not connect to local Paper Todo service (check Node.js >= 22.5)");
                RenderAll();
            }

            _pollTimer.Start();
        }

        private void OnWindowClosing(object sender, System.ComponentModel.CancelEventArgs e)
        {
            if (!_allowExit)
            {
                e.Cancel = true;
                Hide();
            }
        }

        private void OnWindowClosed(object sender, EventArgs e)
        {
            _pollTimer.Stop();
            _toastTimer.Stop();
            try
            {
                IntPtr hwnd = new WindowInteropHelper(this).Handle;
                if (hwnd != IntPtr.Zero)
                {
                    NativeInterop.UnregisterHotKey(hwnd, NativeInterop.HOTKEY_ID_TOGGLE);
                }
            }
            catch { }

            if (_trayIcon != null)
            {
                _trayIcon.Visible = false;
                _trayIcon.Dispose();
                _trayIcon = null;
            }
            if (_trayMenu != null)
            {
                _trayMenu.Dispose();
                _trayMenu = null;
            }
            if (_trayGdiIcon != null)
            {
                _trayGdiIcon.Dispose();
                _trayGdiIcon = null;
            }
            _api.Dispose();
        }

        private void OnWindowPreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.N && (Keyboard.Modifiers & ModifierKeys.Control) == ModifierKeys.Control)
            {
                if (_composerInput != null)
                {
                    _composerInput.Focus();
                }
                e.Handled = true;
                return;
            }
            if (e.Key == Key.P && (Keyboard.Modifiers & ModifierKeys.Control) == ModifierKeys.Control)
            {
                ToggleAlwaysOnTop();
                e.Handled = true;
                return;
            }
            if (e.Key == Key.Escape)
            {
                if (_editingId.HasValue)
                {
                    OnCancelEdit();
                    e.Handled = true;
                    return;
                }
                if (_composerInput != null && string.IsNullOrEmpty(_composerInput.Text))
                {
                    if (_composerExtrasOpen && _composerExtras != null)
                    {
                        _composerExtrasOpen = false;
                        _composerExtras.Visibility = Visibility.Collapsed;
                        Keyboard.ClearFocus();
                    }
                    else
                    {
                        Hide();
                    }
                    e.Handled = true;
                }
            }
        }

        private void OnWindowPreviewMouseDown(object sender, MouseButtonEventArgs e)
        {
            if (!_composerExtrasOpen || _composerBox == null || _composerExtras == null) return;
            DependencyObject hit = e.OriginalSource as DependencyObject;
            if (hit != null && IsDescendantOf(hit, _composerBox))
            {
                return;
            }
            bool hasDraft = (_composerInput != null && !string.IsNullOrWhiteSpace(_composerInput.Text)) ||
                            (_composerPersonInput != null && !string.IsNullOrWhiteSpace(_composerPersonInput.Text)) ||
                            (_composerDueInput != null && !string.IsNullOrWhiteSpace(_composerDueInput.Text));
            if (!hasDraft)
            {
                _composerExtrasOpen = false;
                _composerExtras.Visibility = Visibility.Collapsed;
            }
        }

        private static bool IsDescendantOf(DependencyObject node, DependencyObject ancestor)
        {
            DependencyObject cur = node;
            while (cur != null)
            {
                if (ReferenceEquals(cur, ancestor)) return true;
                cur = VisualTreeHelper.GetParent(cur);
            }
            return false;
        }

        private void SetupTray()
        {
            _trayGdiIcon = NativeInterop.CreateTrayIcon();
            _trayMenu = new System.Windows.Forms.ContextMenuStrip();

            System.Windows.Forms.ToolStripMenuItem showItem = new System.Windows.Forms.ToolStripMenuItem("Show Paper Todo");
            showItem.Click += delegate
            {
                Dispatcher.BeginInvoke(new Action(SummonFromExternal));
            };

            _trayPinItem = new System.Windows.Forms.ToolStripMenuItem("Always on Top");
            _trayPinItem.CheckOnClick = false;
            _trayPinItem.Checked = Topmost;
            _trayPinItem.Click += delegate
            {
                Dispatcher.BeginInvoke(new Action(ToggleAlwaysOnTop));
            };

            System.Windows.Forms.ToolStripMenuItem themeItem = new System.Windows.Forms.ToolStripMenuItem("Switch Light / Dark Paper");
            themeItem.Click += delegate
            {
                Dispatcher.BeginInvoke(new Action(ToggleTheme));
            };

            System.Windows.Forms.ToolStripMenuItem quitItem = new System.Windows.Forms.ToolStripMenuItem("Quit");
            quitItem.Click += delegate
            {
                Dispatcher.BeginInvoke(new Action(ExitApp));
            };

            _trayMenu.Items.Add(showItem);
            _trayMenu.Items.Add(_trayPinItem);
            _trayMenu.Items.Add(themeItem);
            _trayMenu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
            _trayMenu.Items.Add(quitItem);

            _trayIcon = new System.Windows.Forms.NotifyIcon();
            _trayIcon.Icon = _trayGdiIcon;
            _trayIcon.Text = "Paper Todo (Alt+Shift+T)";
            _trayIcon.ContextMenuStrip = _trayMenu;
            _trayIcon.Visible = true;
            _trayIcon.MouseClick += delegate(object s, System.Windows.Forms.MouseEventArgs e)
            {
                if (e.Button == System.Windows.Forms.MouseButtons.Left)
                {
                    Dispatcher.BeginInvoke(new Action(ToggleVisibilityAndFocus));
                }
            };
        }

        private void ExitApp()
        {
            _allowExit = true;
            Close();
            System.Windows.Application.Current.Shutdown();
        }

        private void ToggleAlwaysOnTop()
        {
            Topmost = !Topmost;
            if (_trayPinItem != null)
            {
                _trayPinItem.Checked = Topmost;
            }
            UpdatePinButtonVisual();
            ShowToast(Topmost ? "Pinned on top" : "Unpinned");
        }

        private void UpdatePinButtonVisual()
        {
            if (_pinBtn == null || _pinPath == null) return;
            _pinPath.Stroke = Topmost ? _palette.Accent : _palette.InkSecondary;
            _pinBtn.Background = Topmost ? _palette.AccentSoft : Brushes.Transparent;
            _pinBtn.BorderBrush = Topmost ? _palette.AccentSoft : Brushes.Transparent;
            _pinBtn.ToolTip = Topmost ? "Pinned on top (Ctrl+P)" : "Always on top (Ctrl+P)";
        }

        private void ToggleTheme()
        {
            SaveDraftInputs();
            _isDark = !_isDark;
            _palette = _isDark ? PaperPalette.Dark() : PaperPalette.Light();
            Background = _palette.PaperBg;
            NativeInterop.ApplyWindows11Polish(this, _isDark);
            BuildLayout();
            RenderAll();
        }

        private void SaveDraftInputs()
        {
            if (_composerInput != null) _draftTitle = _composerInput.Text ?? "";
            if (_composerPersonInput != null) _draftPerson = _composerPersonInput.Text ?? "";
            if (_composerDueInput != null) _draftDue = _composerDueInput.Text ?? "";
        }

        private void BuildLayout()
        {
            _rootGrid = new Grid();
            _rootGrid.Background = _palette.PaperBg;

            // Cotton paper fiber grain
            Rectangle grainRect = new Rectangle();
            grainRect.Fill = _palette.GrainBrush;
            grainRect.IsHitTestVisible = false;
            _rootGrid.Children.Add(grainRect);

            // Classic stationery vertical margin line
            Rectangle marginLine = new Rectangle();
            marginLine.Width = 1;
            marginLine.HorizontalAlignment = HorizontalAlignment.Left;
            marginLine.Margin = new Thickness(28, 0, 0, 0);
            marginLine.Fill = _palette.MarginLine;
            marginLine.IsHitTestVisible = false;
            _rootGrid.Children.Add(marginLine);

            // Main 5-row layout inside paper margin
            Grid layout = new Grid();
            layout.Margin = new Thickness(42, 0, 20, 0);
            layout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // Caption + Masthead
            layout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // Filter tabs + People
            layout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // Composer
            layout.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // List
            layout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // Footer

            // --- Row 0: Draggable caption + Serif masthead ---
            StackPanel headerStack = new StackPanel();

            Grid captionBar = new Grid();
            captionBar.Height = 36;
            captionBar.Background = Brushes.Transparent;

            TextBlock dateStamp = new TextBlock();
            dateStamp.Text = DateTime.Now.ToString("ddd \u00B7 MMM d, yyyy", CultureInfo.InvariantCulture);
            dateStamp.FontFamily = PaperPalette.MonoFont;
            dateStamp.FontSize = 10.8;
            dateStamp.Foreground = _palette.InkMuted;
            dateStamp.VerticalAlignment = VerticalAlignment.Bottom;
            dateStamp.Margin = new Thickness(0, 0, 0, 4);
            captionBar.Children.Add(dateStamp);

            StackPanel rightControls = new StackPanel();
            rightControls.Orientation = Orientation.Horizontal;
            rightControls.HorizontalAlignment = HorizontalAlignment.Right;
            rightControls.VerticalAlignment = VerticalAlignment.Center;
            WindowChrome.SetIsHitTestVisibleInChrome(rightControls, true);

            // Sync indicator
            StackPanel syncPanel = new StackPanel();
            syncPanel.Orientation = Orientation.Horizontal;
            syncPanel.VerticalAlignment = VerticalAlignment.Center;
            syncPanel.Margin = new Thickness(0, 0, 8, 0);

            _syncDot = new Ellipse();
            _syncDot.Width = 6;
            _syncDot.Height = 6;
            _syncDot.Fill = _palette.SyncLive;
            _syncDot.VerticalAlignment = VerticalAlignment.Center;
            _syncDot.Margin = new Thickness(0, 0, 5, 0);

            _syncLabel = new TextBlock();
            _syncLabel.Text = "Synced";
            _syncLabel.FontFamily = PaperPalette.MonoFont;
            _syncLabel.FontSize = 10.5;
            _syncLabel.Foreground = _palette.InkMuted;
            _syncLabel.VerticalAlignment = VerticalAlignment.Center;

            syncPanel.Children.Add(_syncDot);
            syncPanel.Children.Add(_syncLabel);
            rightControls.Children.Add(syncPanel);

            // Pin button
            _pinPath = UiHelpers.MakeIcon(UiHelpers.ICON_PIN, _palette.InkSecondary, 13, 1.6);
            _pinBtn = UiHelpers.MakeFlatButton(
                _pinPath,
                _palette,
                "Always on top (Ctrl+P)",
                new Thickness(6, 5, 6, 5),
                4,
                Brushes.Transparent,
                Brushes.Transparent,
                _palette.PaperHover
            );
            _pinBtn.Margin = new Thickness(1, 0, 1, 0);
            _pinBtn.Click += delegate { ToggleAlwaysOnTop(); };
            UpdatePinButtonVisual();
            rightControls.Children.Add(_pinBtn);

            // Theme toggle
            Path sunPath = UiHelpers.MakeIcon(UiHelpers.ICON_SUN, _palette.InkSecondary, 13, 1.6);
            Button themeBtn = UiHelpers.MakeFlatButton(
                sunPath,
                _palette,
                "Switch light / dark paper",
                new Thickness(6, 5, 6, 5),
                4,
                null,
                Brushes.Transparent,
                _palette.PaperHover
            );
            themeBtn.Margin = new Thickness(1, 0, 1, 0);
            themeBtn.Click += delegate { ToggleTheme(); };
            rightControls.Children.Add(themeBtn);

            // Minimize
            Path minPath = UiHelpers.MakeIcon(UiHelpers.ICON_MINIMIZE, _palette.InkSecondary, 12, 1.6);
            Button minBtn = UiHelpers.MakeFlatButton(
                minPath,
                _palette,
                "Minimize",
                new Thickness(6, 6, 6, 6),
                4,
                null,
                Brushes.Transparent,
                _palette.PaperHover
            );
            minBtn.Margin = new Thickness(1, 0, 1, 0);
            minBtn.Click += delegate { WindowState = WindowState.Minimized; };
            rightControls.Children.Add(minBtn);

            // Close to tray
            Path closePath = UiHelpers.MakeIcon(UiHelpers.ICON_CLOSE, _palette.InkSecondary, 11.5, 1.6);
            Button closeBtn = UiHelpers.MakeFlatButton(
                closePath,
                _palette,
                "Hide to tray (Esc)",
                new Thickness(6, 6, 6, 6),
                4,
                null,
                Brushes.Transparent,
                _palette.AccentSoft
            );
            closeBtn.Margin = new Thickness(1, 0, 0, 0);
            closeBtn.Click += delegate { Hide(); };
            rightControls.Children.Add(closeBtn);

            captionBar.Children.Add(rightControls);
            headerStack.Children.Add(captionBar);

            Border mastheadBorder = new Border();
            mastheadBorder.BorderBrush = _palette.RuleStrong;
            mastheadBorder.BorderThickness = new Thickness(0, 0, 0, 1);
            mastheadBorder.Padding = new Thickness(0, 0, 0, 11);

            TextBlock titleTb = new TextBlock();
            titleTb.Text = "Paper Todo";
            titleTb.FontFamily = PaperPalette.SerifFont;
            titleTb.FontSize = 21;
            titleTb.FontWeight = FontWeights.SemiBold;
            titleTb.Foreground = _palette.InkPrimary;
            mastheadBorder.Child = titleTb;
            headerStack.Children.Add(mastheadBorder);

            Grid.SetRow(headerStack, 0);
            layout.Children.Add(headerStack);

            // --- Row 1: Filter bar (tabs + people chips) ---
            StackPanel filterBar = new StackPanel();
            Border tabsHost = new Border();
            tabsHost.BorderBrush = _palette.RuleLine;
            tabsHost.BorderThickness = new Thickness(0, 0, 0, 1);
            tabsHost.Padding = new Thickness(0, 8, 0, 0);

            _tabsRow = new StackPanel();
            _tabsRow.Orientation = Orientation.Horizontal;
            tabsHost.Child = _tabsRow;
            filterBar.Children.Add(tabsHost);

            _peopleBarBorder = new Border();
            _peopleBarBorder.BorderBrush = _palette.RuleLine;
            _peopleBarBorder.BorderThickness = new Thickness(0, 0, 0, 1);
            _peopleBarBorder.Padding = new Thickness(0, 6, 0, 7);
            _peopleBarBorder.Visibility = Visibility.Collapsed;

            _peoplePanel = new WrapPanel();
            _peopleBarBorder.Child = _peoplePanel;
            filterBar.Children.Add(_peopleBarBorder);

            Grid.SetRow(filterBar, 1);
            layout.Children.Add(filterBar);

            // --- Row 2: Ruled Quick-Add Composer ---
            _composerBox = new Border();
            _composerBox.BorderBrush = _palette.RuleLine;
            _composerBox.BorderThickness = new Thickness(0, 0, 0, 1);
            _composerBox.Padding = new Thickness(0, 10, 0, 10);

            StackPanel composerStack = new StackPanel();
            Grid composerLine = new Grid();
            composerLine.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            composerLine.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            composerLine.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            TextBlock plusGlyph = new TextBlock();
            plusGlyph.Text = "+";
            plusGlyph.FontFamily = PaperPalette.MonoFont;
            plusGlyph.FontSize = 15;
            plusGlyph.Foreground = _palette.InkMuted;
            plusGlyph.VerticalAlignment = VerticalAlignment.Center;
            plusGlyph.Margin = new Thickness(0, 0, 8, 1);
            Grid.SetColumn(plusGlyph, 0);
            composerLine.Children.Add(plusGlyph);

            TextBlock compPh;
            Grid compInputGrid = UiHelpers.MakePlaceholderTextBox(
                "Write a task\u2026 (@person  !urgent  ~waiting  *focus)",
                _palette,
                13.2,
                false,
                out _composerInput,
                out compPh
            );
            _composerInput.Text = _draftTitle;
            _composerInput.GotKeyboardFocus += delegate
            {
                _composerExtrasOpen = true;
                if (_composerExtras != null)
                {
                    _composerExtras.Visibility = Visibility.Visible;
                }
            };
            _composerInput.KeyDown += delegate(object s, KeyEventArgs e)
            {
                if (e.Key == Key.Enter)
                {
                    e.Handled = true;
                    Task ignored = CommitComposerAsync();
                }
            };
            Grid.SetColumn(compInputGrid, 1);
            composerLine.Children.Add(compInputGrid);

            TextBlock addBtnLbl = new TextBlock();
            addBtnLbl.Text = "Add";
            addBtnLbl.FontFamily = PaperPalette.SansFont;
            addBtnLbl.FontSize = 11.8;
            addBtnLbl.Foreground = _palette.InkSecondary;

            Button addBtn = UiHelpers.MakeFlatButton(
                addBtnLbl,
                _palette,
                "Add task (Enter)",
                new Thickness(10, 3, 10, 3),
                4,
                _palette.RuleStrong,
                Brushes.Transparent,
                _palette.PaperHover
            );
            addBtn.Margin = new Thickness(8, 0, 0, 0);
            addBtn.Click += delegate
            {
                Task ignored = CommitComposerAsync();
            };
            Grid.SetColumn(addBtn, 2);
            composerLine.Children.Add(addBtn);

            composerStack.Children.Add(composerLine);

            // Expandable extras row
            _composerExtras = new StackPanel();
            _composerExtras.Margin = new Thickness(18, 9, 0, 0);
            _composerExtras.Visibility = _composerExtrasOpen ? Visibility.Visible : Visibility.Collapsed;

            WrapPanel statusPills = new WrapPanel();
            statusPills.Margin = new Thickness(0, 0, 0, 6);
            string[] cStatusKeys = new string[] { "todo", "now", "waiting", "inbox" };
            string[] cStatusLabels = new string[] { "Todo", "Focus", "Waiting", "Inbox" };
            _composerStatusBtns.Clear();

            for (int i = 0; i < cStatusKeys.Length; i++)
            {
                string k = cStatusKeys[i];
                TextBlock t = new TextBlock();
                t.Text = cStatusLabels[i];
                t.FontFamily = PaperPalette.SansFont;
                t.FontSize = 11.2;
                Button b = UiHelpers.MakeFlatButton(
                    t,
                    _palette,
                    cStatusLabels[i],
                    new Thickness(7, 2, 7, 2),
                    3,
                    _palette.RuleLine,
                    Brushes.Transparent,
                    _palette.PaperHover
                );
                b.Tag = k;
                b.Margin = new Thickness(0, 0, 5, 2);
                b.Click += delegate
                {
                    _composerStatusValue = k;
                    RefreshComposerExtrasVisual();
                };
                _composerStatusBtns.Add(b);
                statusPills.Children.Add(b);
            }
            _composerExtras.Children.Add(statusPills);

            WrapPanel fieldsRow = new WrapPanel();
            fieldsRow.Children.Add(BuildComposerInlineField("Person", "e.g. Alex", _draftPerson, 82, out _composerPersonInput));
            fieldsRow.Children.Add(BuildComposerInlineField("Due", "Today 5pm", _draftDue, 88, out _composerDueInput));

            _composerPersonInput.KeyDown += delegate(object s, KeyEventArgs e)
            {
                if (e.Key == Key.Enter)
                {
                    e.Handled = true;
                    Task ignored = CommitComposerAsync();
                }
            };
            _composerDueInput.KeyDown += delegate(object s, KeyEventArgs e)
            {
                if (e.Key == Key.Enter)
                {
                    e.Handled = true;
                    Task ignored = CommitComposerAsync();
                }
            };

            _composerUrgentText = new TextBlock();
            _composerUrgentText.Text = "! Urgent";
            _composerUrgentText.FontFamily = PaperPalette.MonoFont;
            _composerUrgentText.FontSize = 11;

            _composerUrgentBtn = UiHelpers.MakeFlatButton(
                _composerUrgentText,
                _palette,
                "Mark urgent",
                new Thickness(7, 2, 7, 2),
                3,
                _palette.RuleStrong,
                Brushes.Transparent,
                _palette.PaperHover
            );
            _composerUrgentBtn.Margin = new Thickness(2, 1, 0, 0);
            _composerUrgentBtn.Click += delegate
            {
                _composerUrgent = !_composerUrgent;
                RefreshComposerExtrasVisual();
            };
            fieldsRow.Children.Add(_composerUrgentBtn);

            _composerExtras.Children.Add(fieldsRow);
            RefreshComposerExtrasVisual();
            composerStack.Children.Add(_composerExtras);

            _composerBox.Child = composerStack;
            Grid.SetRow(_composerBox, 2);
            layout.Children.Add(_composerBox);

            // --- Row 3: Scrollable Task List ---
            ScrollViewer scroll = new ScrollViewer();
            scroll.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
            scroll.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
            scroll.PanningMode = PanningMode.VerticalOnly;
            scroll.Resources.Add(typeof(ScrollBar), PaperPalette.CreateThinScrollBarStyle(_palette));

            _listStack = new StackPanel();
            _listStack.Margin = new Thickness(0, 4, 4, 12);
            scroll.Content = _listStack;

            Grid.SetRow(scroll, 3);
            layout.Children.Add(scroll);

            // --- Row 4: Footer ---
            Border footerBorder = new Border();
            footerBorder.BorderBrush = _palette.RuleLine;
            footerBorder.BorderThickness = new Thickness(0, 1, 0, 0);
            footerBorder.Padding = new Thickness(0, 9, 0, 12);

            Grid footerGrid = new Grid();
            _footerStats = new TextBlock();
            _footerStats.FontFamily = PaperPalette.MonoFont;
            _footerStats.FontSize = 10.6;
            _footerStats.Foreground = _palette.InkMuted;
            _footerStats.VerticalAlignment = VerticalAlignment.Center;
            footerGrid.Children.Add(_footerStats);

            StackPanel footerRight = new StackPanel();
            footerRight.Orientation = Orientation.Horizontal;
            footerRight.HorizontalAlignment = HorizontalAlignment.Right;
            footerRight.VerticalAlignment = VerticalAlignment.Center;

            TextBlock hotkeyHint = new TextBlock();
            hotkeyHint.Text = "Alt+Shift+T";
            hotkeyHint.FontFamily = PaperPalette.MonoFont;
            hotkeyHint.FontSize = 10.2;
            hotkeyHint.Foreground = _palette.InkFaint;
            hotkeyHint.VerticalAlignment = VerticalAlignment.Center;
            footerRight.Children.Add(hotkeyHint);

            TextBlock clearLbl = new TextBlock();
            clearLbl.Text = "Clear done";
            clearLbl.FontFamily = PaperPalette.MonoFont;
            clearLbl.FontSize = 10.6;
            clearLbl.Foreground = _palette.InkSecondary;
            clearLbl.TextDecorations = TextDecorations.Underline;

            _clearDoneBtn = UiHelpers.MakeFlatButton(
                clearLbl,
                _palette,
                "Remove all completed items",
                new Thickness(5, 2, 2, 2),
                3,
                null,
                Brushes.Transparent,
                _palette.PaperHover
            );
            _clearDoneBtn.Margin = new Thickness(10, 0, 0, 0);
            _clearDoneBtn.Visibility = Visibility.Collapsed;
            _clearDoneBtn.Click += delegate
            {
                Task ignored = RunMutationAsync(delegate { return _api.ClearCompletedAsync(); });
            };
            footerRight.Children.Add(_clearDoneBtn);

            footerGrid.Children.Add(footerRight);
            footerBorder.Child = footerGrid;

            Grid.SetRow(footerBorder, 4);
            layout.Children.Add(footerBorder);

            _rootGrid.Children.Add(layout);

            // Overlay toast
            _toastBorder = new Border();
            _toastBorder.Background = _palette.InkPrimary;
            _toastBorder.CornerRadius = new CornerRadius(4);
            _toastBorder.Padding = new Thickness(11, 5, 11, 5);
            _toastBorder.HorizontalAlignment = HorizontalAlignment.Right;
            _toastBorder.VerticalAlignment = VerticalAlignment.Bottom;
            _toastBorder.Margin = new Thickness(0, 0, 20, 42);
            _toastBorder.Visibility = Visibility.Collapsed;
            _toastBorder.IsHitTestVisible = false;

            _toastLabel = new TextBlock();
            _toastLabel.FontFamily = PaperPalette.SansFont;
            _toastLabel.FontSize = 11.5;
            _toastLabel.Foreground = _palette.PaperBg;
            _toastBorder.Child = _toastLabel;
            _rootGrid.Children.Add(_toastBorder);

            Content = _rootGrid;
        }

        private UIElement BuildComposerInlineField(string label, string placeholder, string initialValue, double width, out TextBox box)
        {
            StackPanel sp = new StackPanel();
            sp.Orientation = Orientation.Horizontal;
            sp.Margin = new Thickness(0, 1, 10, 2);

            TextBlock lbl = new TextBlock();
            lbl.Text = label;
            lbl.FontFamily = PaperPalette.SansFont;
            lbl.FontSize = 11.2;
            lbl.Foreground = _palette.InkMuted;
            lbl.VerticalAlignment = VerticalAlignment.Center;
            lbl.Margin = new Thickness(0, 0, 5, 0);

            Border line = new Border();
            line.BorderBrush = _palette.RuleStrong;
            line.BorderThickness = new Thickness(0, 0, 0, 1);
            line.Width = width;

            TextBlock ph;
            line.Child = UiHelpers.MakePlaceholderTextBox(placeholder, _palette, 11.6, false, out box, out ph);
            box.Text = initialValue;

            sp.Children.Add(lbl);
            sp.Children.Add(line);
            return sp;
        }

        private void RefreshComposerExtrasVisual()
        {
            for (int i = 0; i < _composerStatusBtns.Count; i++)
            {
                Button b = _composerStatusBtns[i];
                string key = b.Tag as string;
                bool active = key == _composerStatusValue;
                b.BorderBrush = active ? _palette.InkPrimary : _palette.RuleLine;
                b.Background = active ? _palette.PaperElevated : Brushes.Transparent;
                TextBlock t = b.Content as TextBlock;
                if (t != null)
                {
                    t.Foreground = active ? _palette.InkPrimary : _palette.InkSecondary;
                    t.FontWeight = active ? FontWeights.SemiBold : FontWeights.Normal;
                }
            }

            if (_composerUrgentBtn != null && _composerUrgentText != null)
            {
                _composerUrgentBtn.BorderBrush = _composerUrgent ? _palette.Accent : _palette.RuleStrong;
                _composerUrgentBtn.Background = _composerUrgent ? _palette.AccentSoft : Brushes.Transparent;
                _composerUrgentText.Foreground = _composerUrgent ? _palette.Accent : _palette.InkSecondary;
                _composerUrgentText.FontWeight = _composerUrgent ? FontWeights.Bold : FontWeights.Normal;
            }
        }

        private void SetSyncStatus(bool live, bool syncing, string label)
        {
            if (_syncDot != null)
            {
                _syncDot.Fill = syncing ? _palette.Accent : (live ? _palette.SyncLive : _palette.InkFaint);
            }
            if (_syncLabel != null)
            {
                _syncLabel.Text = label;
            }
        }

        private void ShowToast(string text)
        {
            if (_toastBorder == null || _toastLabel == null) return;
            _toastLabel.Text = text;
            _toastBorder.Visibility = Visibility.Visible;
            _toastTimer.Stop();
            _toastTimer.Start();
        }

        private void ApplyBoard(BoardResponse board, bool highlightChanges)
        {
            if (board == null || board.todos == null || board.counts == null) return;

            _freshIds.Clear();
            if (highlightChanges && _prevSignatures.Count > 0)
            {
                for (int i = 0; i < board.todos.Count; i++)
                {
                    TodoItem item = board.todos[i];
                    string prev;
                    if (!_prevSignatures.TryGetValue(item.id, out prev) || prev != item.Signature())
                    {
                        _freshIds.Add(item.id);
                    }
                }
            }

            _prevSignatures.Clear();
            for (int i = 0; i < board.todos.Count; i++)
            {
                TodoItem item = board.todos[i];
                _prevSignatures[item.id] = item.Signature();
            }

            _revision = board.revision;
            _todos = board.todos;
            _counts = board.counts;
            _people = board.people ?? new List<string>();

            if (!string.IsNullOrEmpty(_selectedPerson) && !_people.Contains(_selectedPerson))
            {
                _selectedPerson = "";
            }

            SetSyncStatus(true, false, "Synced");
            RenderAll();
        }

        private async Task LoadBoardAsync(bool highlightChanges)
        {
            try
            {
                BoardResponse board = await _api.GetBoardAsync(null);
                if (board != null && board.todos != null)
                {
                    ApplyBoard(board, highlightChanges);
                }
            }
            catch
            {
                SetSyncStatus(false, false, "Reconnecting");
            }
        }

        private async Task PollBoardAsync(bool force)
        {
            if (_pollInFlight || _mutationInFlight) return;
            if (!force && _editingId.HasValue) return;
            _pollInFlight = true;
            try
            {
                int? since = _revision > 0 ? (int?)_revision : null;
                BoardResponse board = await _api.GetBoardAsync(since);
                if (board != null)
                {
                    if (board.changed && board.todos != null)
                    {
                        ApplyBoard(board, true);
                    }
                    else
                    {
                        SetSyncStatus(true, false, "Synced");
                    }
                }
            }
            catch
            {
                SetSyncStatus(false, false, "Reconnecting");
            }
            finally
            {
                _pollInFlight = false;
            }
        }

        private async Task RunMutationAsync(Func<Task<BoardResponse>> action)
        {
            if (_mutationInFlight) return;
            _mutationInFlight = true;
            SetSyncStatus(true, true, "Saving…");
            try
            {
                await _api.EnsureBackendAsync();
                BoardResponse board = await action();
                if (board != null && board.todos != null)
                {
                    ApplyBoard(board, false);
                }
                else
                {
                    await LoadBoardAsync(false);
                }
            }
            catch
            {
                SetSyncStatus(false, false, "Reconnecting");
                ShowToast("Could not save change — retrying");
            }
            finally
            {
                _mutationInFlight = false;
            }
        }

        private async Task CommitComposerAsync()
        {
            if (_composerInput == null) return;
            string raw = (_composerInput.Text ?? "").Trim();
            if (string.IsNullOrEmpty(raw)) return;

            string text = raw;
            string status = _composerStatusValue;
            string priority = _composerUrgent ? "high" : "normal";
            string person = _composerPersonInput != null ? (_composerPersonInput.Text ?? "").Trim().TrimStart('@') : "";
            string due = _composerDueInput != null ? (_composerDueInput.Text ?? "").Trim() : "";

            if (text.StartsWith("~"))
            {
                status = "waiting";
                text = text.Substring(1).Trim();
            }
            else if (text.StartsWith("*"))
            {
                status = "now";
                text = text.Substring(1).Trim();
            }

            if (Regex.IsMatch(text, @"(^|\s)!(?=\s|$)") || text.EndsWith("!"))
            {
                priority = "high";
                text = Regex.Replace(text, @"(^|\s)!(?=\s|$)", " ");
                text = Regex.Replace(text, @"!+$", "").Trim();
            }

            Match personMatch = Regex.Match(text, @"(?:^|\s)@([^\s@#!]+)");
            if (personMatch.Success)
            {
                if (string.IsNullOrEmpty(person))
                {
                    person = personMatch.Groups[1].Value;
                }
                text = text.Remove(personMatch.Index, personMatch.Length);
                text = Regex.Replace(text, @"\s+", " ").Trim();
            }

            if (string.IsNullOrEmpty(text)) return;

            _composerInput.Text = "";
            if (_composerPersonInput != null) _composerPersonInput.Text = "";
            if (_composerDueInput != null) _composerDueInput.Text = "";
            _draftTitle = "";
            _draftPerson = "";
            _draftDue = "";
            _composerStatusValue = "todo";
            _composerUrgent = false;
            _composerExtrasOpen = false;
            if (_composerExtras != null)
            {
                _composerExtras.Visibility = Visibility.Collapsed;
            }
            RefreshComposerExtrasVisual();

            Dictionary<string, object> payload = new Dictionary<string, object>();
            payload["title"] = text;
            payload["status"] = status;
            payload["priority"] = priority;
            payload["source"] = "manual";
            if (!string.IsNullOrEmpty(person)) payload["person"] = person;
            if (!string.IsNullOrEmpty(due)) payload["due"] = due;

            await RunMutationAsync(delegate
            {
                return _api.AddTodoAsync(payload);
            });
        }

        private void RenderAll()
        {
            RenderTabs();
            RenderPeopleBar();
            RenderTaskList();
            RenderFooter();
        }

        private void RenderTabs()
        {
            if (_tabsRow == null) return;
            _tabsRow.Children.Clear();

            string[] keys = new string[] { "active", "now", "inbox", "waiting", "done" };
            string[] labels = new string[] { "Active", "Focus", "Inbox", "Waiting", "Done" };
            int[] cnts = new int[] { _counts.active, _counts.now, _counts.inbox, _counts.waiting, _counts.done };

            for (int i = 0; i < keys.Length; i++)
            {
                string key = keys[i];
                bool isActive = key == _activeTab;
                int count = cnts[i];

                StackPanel sp = new StackPanel();
                sp.Orientation = Orientation.Horizontal;

                TextBlock lbl = new TextBlock();
                lbl.Text = labels[i];
                lbl.FontFamily = PaperPalette.SansFont;
                lbl.FontSize = 12.4;
                lbl.Foreground = isActive ? _palette.InkPrimary : _palette.InkSecondary;
                lbl.FontWeight = isActive ? FontWeights.SemiBold : FontWeights.Normal;

                TextBlock cnt = new TextBlock();
                cnt.Text = count.ToString();
                cnt.FontFamily = PaperPalette.MonoFont;
                cnt.FontSize = 10.8;
                cnt.Margin = new Thickness(5, 1, 0, 0);
                cnt.Foreground = (key == "inbox" && count > 0) ? _palette.Accent : _palette.InkMuted;
                if (key == "inbox" && count > 0) cnt.FontWeight = FontWeights.SemiBold;

                sp.Children.Add(lbl);
                sp.Children.Add(cnt);

                Border tabWrap = new Border();
                tabWrap.BorderBrush = isActive ? _palette.InkPrimary : Brushes.Transparent;
                tabWrap.BorderThickness = new Thickness(0, 0, 0, 1.5);
                tabWrap.Padding = new Thickness(0, 3, 0, 8);
                tabWrap.Margin = new Thickness(0, 0, 15, -1);
                tabWrap.Background = Brushes.Transparent;
                tabWrap.Cursor = Cursors.Hand;
                tabWrap.Child = sp;

                tabWrap.MouseLeftButtonUp += delegate
                {
                    _activeTab = key;
                    _editingId = null;
                    RenderAll();
                };
                _tabsRow.Children.Add(tabWrap);
            }
        }

        private void RenderPeopleBar()
        {
            if (_peopleBarBorder == null || _peoplePanel == null) return;
            _peoplePanel.Children.Clear();

            if (_people.Count == 0 || _activeTab == "done")
            {
                _peopleBarBorder.Visibility = Visibility.Collapsed;
                return;
            }

            _peopleBarBorder.Visibility = Visibility.Visible;
            _peoplePanel.Children.Add(MakePersonChip("Everyone", _selectedPerson == "", delegate
            {
                _selectedPerson = "";
                RenderAll();
            }));

            for (int i = 0; i < _people.Count; i++)
            {
                string person = _people[i];
                _peoplePanel.Children.Add(MakePersonChip("@" + person, _selectedPerson == person, delegate
                {
                    _selectedPerson = (_selectedPerson == person) ? "" : person;
                    RenderAll();
                }));
            }
        }

        private Button MakePersonChip(string label, bool active, Action onClick)
        {
            TextBlock tb = new TextBlock();
            tb.Text = label;
            tb.FontFamily = PaperPalette.MonoFont;
            tb.FontSize = 11.2;
            tb.Foreground = active ? _palette.Accent : _palette.InkSecondary;
            tb.FontWeight = active ? FontWeights.SemiBold : FontWeights.Normal;

            Button chip = UiHelpers.MakeFlatButton(
                tb,
                _palette,
                label,
                new Thickness(5, 1, 5, 1),
                3,
                null,
                active ? _palette.AccentSoft : Brushes.Transparent,
                _palette.PaperHover
            );
            chip.Margin = new Thickness(0, 0, 7, 1);
            chip.Click += delegate { onClick(); };
            return chip;
        }

        private List<TodoItem> GetFilteredTodos()
        {
            List<TodoItem> result = new List<TodoItem>();
            for (int i = 0; i < _todos.Count; i++)
            {
                TodoItem item = _todos[i];
                if (_activeTab == "active")
                {
                    if (item.status == "done") continue;
                }
                else if (item.status != _activeTab)
                {
                    continue;
                }

                if (!string.IsNullOrEmpty(_selectedPerson) && item.person != _selectedPerson)
                {
                    continue;
                }
                result.Add(item);
            }
            return result;
        }

        private void RenderTaskList()
        {
            if (_listStack == null) return;
            _listStack.Children.Clear();

            List<TodoItem> items = GetFilteredTodos();
            if (items.Count == 0)
            {
                _listStack.Children.Add(BuildEmptyState());
                return;
            }

            if (_activeTab == "active")
            {
                string[] secKeys = new string[] { "now", "inbox", "todo", "waiting" };
                string[] secTitles = new string[] { "Focus", "Inbox", "Todo", "Waiting" };
                Brush[] secColors = new Brush[] { _palette.Accent, _palette.Inbox, _palette.InkMuted, _palette.Waiting };
                bool isFirst = true;

                for (int s = 0; s < secKeys.Length; s++)
                {
                    List<TodoItem> group = new List<TodoItem>();
                    for (int i = 0; i < items.Count; i++)
                    {
                        if (items[i].status == secKeys[s])
                        {
                            group.Add(items[i]);
                        }
                    }
                    if (group.Count == 0) continue;

                    _listStack.Children.Add(PaperRowBuilder.BuildSectionHeading(secTitles[s], group.Count, secColors[s], _palette, isFirst));
                    isFirst = false;

                    for (int i = 0; i < group.Count; i++)
                    {
                        TodoItem item = group[i];
                        _listStack.Children.Add(PaperRowBuilder.BuildRow(item, _freshIds.Contains(item.id), this));
                    }
                }
            }
            else
            {
                for (int i = 0; i < items.Count; i++)
                {
                    TodoItem item = items[i];
                    _listStack.Children.Add(PaperRowBuilder.BuildRow(item, _freshIds.Contains(item.id), this));
                }
            }
        }

        private UIElement BuildEmptyState()
        {
            StackPanel sp = new StackPanel();
            sp.HorizontalAlignment = HorizontalAlignment.Center;
            sp.Margin = new Thickness(16, 48, 16, 24);

            TextBlock title = new TextBlock();
            title.FontFamily = PaperPalette.SerifFont;
            title.FontSize = 16;
            title.Foreground = _palette.InkSecondary;
            title.HorizontalAlignment = HorizontalAlignment.Center;
            title.Margin = new Thickness(0, 0, 0, 6);

            TextBlock desc = new TextBlock();
            desc.FontFamily = PaperPalette.SansFont;
            desc.FontSize = 12.4;
            desc.Foreground = _palette.InkMuted;
            desc.TextAlignment = TextAlignment.Center;
            desc.TextWrapping = TextWrapping.Wrap;
            desc.MaxWidth = 310;

            if (_counts.total == 0)
            {
                title.Text = "Blank sheet";
                desc.Text = "Write a task above, or tell any Gemini CLI session \"Add a todo...\" — updates appear here automatically.";
                sp.Children.Add(title);
                sp.Children.Add(desc);

                TextBlock seedLbl = new TextBlock();
                seedLbl.Text = "Load 4 sample tasks";
                seedLbl.FontFamily = PaperPalette.SansFont;
                seedLbl.FontSize = 12;
                seedLbl.Foreground = _palette.InkSecondary;

                Button seedBtn = UiHelpers.MakeFlatButton(
                    seedLbl,
                    _palette,
                    "Populate 4 sample tasks",
                    new Thickness(12, 5, 12, 5),
                    4,
                    _palette.RuleStrong,
                    Brushes.Transparent,
                    _palette.PaperHover
                );
                seedBtn.Margin = new Thickness(0, 14, 0, 0);
                seedBtn.HorizontalAlignment = HorizontalAlignment.Center;
                seedBtn.Click += delegate
                {
                    Task ignored = RunMutationAsync(delegate { return _api.SeedDemoAsync(); });
                };
                sp.Children.Add(seedBtn);
            }
            else
            {
                title.Text = "Nothing here";
                desc.Text = !string.IsNullOrEmpty(_selectedPerson)
                    ? string.Format("No items involving @{0} in this view.", _selectedPerson)
                    : "This section is clear.";
                sp.Children.Add(title);
                sp.Children.Add(desc);
            }

            return sp;
        }

        private void RenderFooter()
        {
            if (_footerStats != null)
            {
                _footerStats.Text = string.Format(
                    "{0} active \u00B7 {1} focus \u00B7 {2} waiting \u00B7 {3} done",
                    _counts.active,
                    _counts.now,
                    _counts.waiting,
                    _counts.done
                );
            }
            if (_clearDoneBtn != null)
            {
                _clearDoneBtn.Visibility = _counts.done > 0 ? Visibility.Visible : Visibility.Collapsed;
            }
        }

        // --- IPaperRowHost ---
        public void OnToggleDone(int id)
        {
            Task ignored = RunMutationAsync(delegate { return _api.ToggleTodoAsync(id); });
        }

        public void OnToggleEdit(int id)
        {
            _editingId = (_editingId.HasValue && _editingId.Value == id) ? (int?)null : id;
            RenderTaskList();
        }

        public void OnQuickStatus(int id, string status)
        {
            Dictionary<string, object> payload = new Dictionary<string, object>();
            payload["status"] = status;
            Task ignored = RunMutationAsync(delegate { return _api.UpdateTodoAsync(id, payload); });
        }

        public void OnDelete(int id)
        {
            if (_editingId.HasValue && _editingId.Value == id)
            {
                _editingId = null;
            }
            Task ignored = RunMutationAsync(delegate { return _api.DeleteTodoAsync(id); });
        }

        public void OnSaveEdit(int id, Dictionary<string, object> payload)
        {
            _editingId = null;
            Task ignored = RunMutationAsync(delegate { return _api.UpdateTodoAsync(id, payload); });
        }

        public void OnCancelEdit()
        {
            _editingId = null;
            RenderTaskList();
        }
    }
}
