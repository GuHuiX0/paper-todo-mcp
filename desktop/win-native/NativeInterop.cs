using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace PaperTodoDesktop
{
    internal static class NativeInterop
    {
        public const int WM_HOTKEY = 0x0312;
        public const int HOTKEY_ID_TOGGLE = 0x4A21;

        public const uint MOD_ALT = 0x0001;
        public const uint MOD_SHIFT = 0x0004;
        public const uint MOD_NOREPEAT = 0x4000;
        public const uint VK_T = 0x54;

        private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
        private const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
        private const int DWMWA_BORDER_COLOR = 34;
        private const int DWMWCP_ROUND = 2;

        private static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);

        [StructLayout(LayoutKind.Sequential)]
        private struct MARGINS
        {
            public int cxLeftWidth;
            public int cxRightWidth;
            public int cyTopHeight;
            public int cyBottomHeight;
        }

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(
            IntPtr hwnd,
            int dwAttribute,
            ref int pvAttribute,
            int cbAttribute
        );

        [DllImport("dwmapi.dll")]
        private static extern int DwmExtendFrameIntoClientArea(
            IntPtr hwnd,
            ref MARGINS pMarInset
        );

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool DestroyIcon(IntPtr hIcon);

        private const int SW_RESTORE = 9;

        public static void EnablePerMonitorDpiV2()
        {
            try
            {
                SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            }
            catch
            {
                // Older Windows builds fall back to manifest DPI awareness
            }
        }

        public static void ApplyWindows11Polish(Window window, bool dark)
        {
            try
            {
                IntPtr hwnd = new WindowInteropHelper(window).Handle;
                if (hwnd == IntPtr.Zero) return;

                int corner = DWMWCP_ROUND;
                DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ref corner, Marshal.SizeOf(typeof(int)));

                int darkVal = dark ? 1 : 0;
                DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref darkVal, Marshal.SizeOf(typeof(int)));

                // COLORREF format: 0x00BBGGRR
                // Light cotton border #D6CCC0 -> 0x00C0CCD6 ; Dark archival border #3B3630 -> 0x0030363B
                int borderColor = dark ? 0x0030363B : 0x00C0CCD6;
                DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, ref borderColor, Marshal.SizeOf(typeof(int)));

                MARGINS margins = new MARGINS
                {
                    cxLeftWidth = 1,
                    cxRightWidth = 1,
                    cyTopHeight = 1,
                    cyBottomHeight = 1
                };
                DwmExtendFrameIntoClientArea(hwnd, ref margins);
            }
            catch
            {
                // Non-Win11 or DWM disabled: degrade gracefully
            }
        }

        public static void BringWindowToFront(Window window)
        {
            try
            {
                if (!window.IsVisible)
                {
                    window.Show();
                }
                if (window.WindowState == WindowState.Minimized)
                {
                    window.WindowState = WindowState.Normal;
                }
                IntPtr hwnd = new WindowInteropHelper(window).Handle;
                if (hwnd != IntPtr.Zero)
                {
                    ShowWindow(hwnd, SW_RESTORE);
                    SetForegroundWindow(hwnd);
                }
                window.Activate();
                window.Focus();
            }
            catch
            {
                // Ignore activation races
            }
        }

        public static Icon CreateTrayIcon()
        {
            Bitmap bmp = new Bitmap(32, 32);
            try
            {
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.Clear(Color.Transparent);

                    using (GraphicsPath card = CreateRoundedRect(new RectangleF(4f, 2f, 24f, 28f), 4f))
                    using (SolidBrush fill = new SolidBrush(Color.FromArgb(251, 248, 241)))
                    using (Pen border = new Pen(Color.FromArgb(58, 53, 47), 1.8f))
                    {
                        g.FillPath(fill, card);
                        g.DrawPath(border, card);
                    }

                    // Terracotta margin rule
                    using (Pen marginPen = new Pen(Color.FromArgb(140, 206, 134, 114), 1.1f))
                    {
                        g.DrawLine(marginPen, 11.5f, 4.5f, 11.5f, 27.5f);
                    }

                    // Vermilion checkmark
                    using (Pen checkPen = new Pen(Color.FromArgb(184, 74, 57), 2.1f))
                    {
                        checkPen.StartCap = LineCap.Round;
                        checkPen.EndCap = LineCap.Round;
                        checkPen.LineJoin = LineJoin.Round;
                        g.DrawLines(checkPen, new PointF[]
                        {
                            new PointF(6.8f, 11.5f),
                            new PointF(8.6f, 13.5f),
                            new PointF(11.6f, 9.2f)
                        });
                    }

                    // Ink ruled lines
                    using (Pen line1 = new Pen(Color.FromArgb(50, 44, 38), 1.9f))
                    using (Pen line2 = new Pen(Color.FromArgb(132, 123, 112), 1.6f))
                    using (Pen line3 = new Pen(Color.FromArgb(170, 162, 150), 1.6f))
                    {
                        line1.StartCap = line1.EndCap = LineCap.Round;
                        line2.StartCap = line2.EndCap = LineCap.Round;
                        line3.StartCap = line3.EndCap = LineCap.Round;
                        g.DrawLine(line1, 14f, 11.5f, 24.5f, 11.5f);
                        g.DrawLine(line2, 14f, 17.5f, 23.2f, 17.5f);
                        g.DrawLine(line3, 14f, 23.0f, 21.0f, 23.0f);
                    }
                }

                IntPtr hIcon = bmp.GetHicon();
                try
                {
                    using (Icon temp = Icon.FromHandle(hIcon))
                    {
                        return (Icon)temp.Clone();
                    }
                }
                finally
                {
                    DestroyIcon(hIcon);
                }
            }
            finally
            {
                bmp.Dispose();
            }
        }

        private static GraphicsPath CreateRoundedRect(RectangleF rect, float radius)
        {
            float d = radius * 2f;
            GraphicsPath path = new GraphicsPath();
            path.AddArc(rect.X, rect.Y, d, d, 180, 90);
            path.AddArc(rect.Right - d, rect.Y, d, d, 270, 90);
            path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
            path.AddArc(rect.X, rect.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }
    }
}
