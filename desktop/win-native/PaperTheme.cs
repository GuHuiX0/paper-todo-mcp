using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace PaperTodoDesktop
{
    public sealed class PaperPalette
    {
        public bool IsDark;

        public Color PaperBgColor;
        public Color PaperFlashColor;
        public SolidColorBrush PaperBg;
        public SolidColorBrush PaperElevated;
        public SolidColorBrush PaperHover;
        public SolidColorBrush PaperBorder;
        public SolidColorBrush RuleLine;
        public SolidColorBrush RuleStrong;
        public SolidColorBrush MarginLine;

        public SolidColorBrush InkPrimary;
        public SolidColorBrush InkSecondary;
        public SolidColorBrush InkMuted;
        public SolidColorBrush InkFaint;

        public SolidColorBrush Accent;
        public SolidColorBrush AccentSoft;
        public SolidColorBrush Waiting;
        public SolidColorBrush WaitingSoft;
        public SolidColorBrush Inbox;
        public SolidColorBrush InboxSoft;
        public SolidColorBrush SyncLive;

        public ImageBrush GrainBrush;

        public static readonly FontFamily SerifFont = new FontFamily("Georgia, Palatino Linotype, Times New Roman");
        public static readonly FontFamily SansFont = new FontFamily("Segoe UI Variable Text, Segoe UI, Microsoft YaHei UI");
        public static readonly FontFamily MonoFont = new FontFamily("Cascadia Mono, Consolas, Courier New");

        public static PaperPalette Light()
        {
            PaperPalette p = new PaperPalette();
            p.IsDark = false;
            p.PaperBgColor = Hex("#FBF8F1");
            p.PaperFlashColor = Color.FromArgb(30, 182, 70, 54);
            p.PaperBg = Brush(p.PaperBgColor);
            p.PaperElevated = Brush(Hex("#F4EFE3"));
            p.PaperHover = Brush(Color.FromArgb(13, 94, 79, 58));
            p.PaperBorder = Brush(Color.FromArgb(38, 74, 62, 47));
            p.RuleLine = Brush(Color.FromArgb(26, 74, 62, 47));
            p.RuleStrong = Brush(Color.FromArgb(52, 74, 62, 47));
            p.MarginLine = Brush(Color.FromArgb(62, 194, 122, 102));

            p.InkPrimary = Brush(Hex("#2A2520"));
            p.InkSecondary = Brush(Hex("#6E665C"));
            p.InkMuted = Brush(Hex("#9B9285"));
            p.InkFaint = Brush(Hex("#C4BBB0"));

            p.Accent = Brush(Hex("#B64636"));
            p.AccentSoft = Brush(Color.FromArgb(26, 182, 70, 54));
            p.Waiting = Brush(Hex("#8C6835"));
            p.WaitingSoft = Brush(Color.FromArgb(30, 140, 104, 53));
            p.Inbox = Brush(Hex("#4C6B7A"));
            p.InboxSoft = Brush(Color.FromArgb(30, 76, 107, 122));
            p.SyncLive = Brush(Hex("#6B8F71"));

            p.GrainBrush = CreateGrainBrush(false);
            return p;
        }

        public static PaperPalette Dark()
        {
            PaperPalette p = new PaperPalette();
            p.IsDark = true;
            p.PaperBgColor = Hex("#1F1D1A");
            p.PaperFlashColor = Color.FromArgb(38, 222, 117, 98);
            p.PaperBg = Brush(p.PaperBgColor);
            p.PaperElevated = Brush(Hex("#272420"));
            p.PaperHover = Brush(Color.FromArgb(13, 242, 232, 214));
            p.PaperBorder = Brush(Color.FromArgb(34, 235, 224, 206));
            p.RuleLine = Brush(Color.FromArgb(24, 235, 224, 206));
            p.RuleStrong = Brush(Color.FromArgb(52, 235, 224, 206));
            p.MarginLine = Brush(Color.FromArgb(50, 212, 130, 112));

            p.InkPrimary = Brush(Hex("#EAE3D8"));
            p.InkSecondary = Brush(Hex("#A69D90"));
            p.InkMuted = Brush(Hex("#787065"));
            p.InkFaint = Brush(Hex("#4D473F"));

            p.Accent = Brush(Hex("#DE7562"));
            p.AccentSoft = Brush(Color.FromArgb(36, 222, 117, 98));
            p.Waiting = Brush(Hex("#CCA266"));
            p.WaitingSoft = Brush(Color.FromArgb(36, 204, 162, 102));
            p.Inbox = Brush(Hex("#7BA6BA"));
            p.InboxSoft = Brush(Color.FromArgb(36, 123, 166, 186));
            p.SyncLive = Brush(Hex("#7CA382"));

            p.GrainBrush = CreateGrainBrush(true);
            return p;
        }

        private static Color Hex(string hex)
        {
            return (Color)ColorConverter.ConvertFromString(hex);
        }

        private static SolidColorBrush Brush(Color c)
        {
            SolidColorBrush b = new SolidColorBrush(c);
            b.Freeze();
            return b;
        }

        private static ImageBrush CreateGrainBrush(bool dark)
        {
            const int size = 128;
            byte[] pixels = new byte[size * size * 4];
            uint seed = 0x51C39B21u;
            for (int i = 0; i < size * size; i++)
            {
                seed = seed * 1664525u + 1013904223u;
                byte v = (byte)((seed >> 24) & 0xFF);
                int idx = i * 4;
                if (dark)
                {
                    pixels[idx] = 228;
                    pixels[idx + 1] = 236;
                    pixels[idx + 2] = 244;
                    pixels[idx + 3] = (byte)(v / 26); // delicate charcoal fiber texture
                }
                else
                {
                    pixels[idx] = 52;
                    pixels[idx + 1] = 66;
                    pixels[idx + 2] = 78;
                    pixels[idx + 3] = (byte)(v / 32); // delicate cotton paper grain
                }
            }

            WriteableBitmap wb = new WriteableBitmap(size, size, 96, 96, PixelFormats.Bgra32, null);
            wb.WritePixels(new Int32Rect(0, 0, size, size), pixels, size * 4, 0);
            wb.Freeze();

            ImageBrush brush = new ImageBrush(wb);
            brush.TileMode = TileMode.Tile;
            brush.Viewport = new Rect(0, 0, size, size);
            brush.ViewportUnits = BrushMappingMode.Absolute;
            brush.Freeze();
            return brush;
        }

        public static Style CreateThinScrollBarStyle(PaperPalette palette)
        {
            string thumbColor = palette.IsDark ? "#3CEBE0CE" : "#384A3E2F";
            string xaml = string.Format(
                "<Style xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\" " +
                "xmlns:x=\"http://schemas.microsoft.com/winfx/2006/xaml\" " +
                "TargetType=\"ScrollBar\">" +
                "<Setter Property=\"Width\" Value=\"6\"/>" +
                "<Setter Property=\"MinWidth\" Value=\"6\"/>" +
                "<Setter Property=\"Background\" Value=\"Transparent\"/>" +
                "<Setter Property=\"Template\">" +
                "<Setter.Value>" +
                "<ControlTemplate TargetType=\"ScrollBar\">" +
                "<Grid Background=\"Transparent\">" +
                "<Track x:Name=\"PART_Track\" IsDirectionReversed=\"True\">" +
                "<Track.DecreaseRepeatButton>" +
                "<RepeatButton Command=\"ScrollBar.PageUpCommand\" Opacity=\"0\" Focusable=\"False\"/>" +
                "</Track.DecreaseRepeatButton>" +
                "<Track.Thumb>" +
                "<Thumb>" +
                "<Thumb.Template>" +
                "<ControlTemplate TargetType=\"Thumb\">" +
                "<Border Background=\"{0}\" CornerRadius=\"3\" Margin=\"1,2,1,2\"/>" +
                "</ControlTemplate>" +
                "</Thumb.Template>" +
                "</Thumb>" +
                "</Track.Thumb>" +
                "<Track.IncreaseRepeatButton>" +
                "<RepeatButton Command=\"ScrollBar.PageDownCommand\" Opacity=\"0\" Focusable=\"False\"/>" +
                "</Track.IncreaseRepeatButton>" +
                "</Track>" +
                "</Grid>" +
                "</ControlTemplate>" +
                "</Setter.Value>" +
                "</Setter>" +
                "</Style>",
                thumbColor
            );
            return (Style)XamlReader.Parse(xaml);
        }
    }
}
