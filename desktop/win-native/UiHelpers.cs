using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;

namespace PaperTodoDesktop
{
    internal static class UiHelpers
    {
        public static Path MakeIcon(string pathData, Brush stroke, double size, double strokeWidth)
        {
            Path p = new Path();
            p.Data = Geometry.Parse(pathData);
            p.Stroke = stroke;
            p.StrokeThickness = strokeWidth;
            p.StrokeStartLineCap = PenLineCap.Round;
            p.StrokeEndLineCap = PenLineCap.Round;
            p.StrokeLineJoin = PenLineJoin.Round;
            p.Width = size;
            p.Height = size;
            p.Stretch = Stretch.Uniform;
            p.SnapsToDevicePixels = true;
            return p;
        }

        // Vector paths (clean 16x16 / 24x24 coordinates)
        public const string ICON_PIN = "M12,3 L12,11 M8.5,11 L15.5,11 L14,15 L10,15 Z M12,15 L12,21";
        public const string ICON_SUN = "M12,3 L12,5 M12,19 L12,21 M4.9,4.9 L6.3,6.3 M17.7,17.7 L19.1,19.1 M3,12 L5,12 M19,12 L21,12 M4.9,19.1 L6.3,17.7 M17.7,6.3 L19.1,4.9 M15.5,12 A3.5,3.5 0 1,1 8.5,12 A3.5,3.5 0 1,1 15.5,12";
        public const string ICON_MINIMIZE = "M4,12 L20,12";
        public const string ICON_CLOSE = "M6,6 L18,18 M18,6 L6,18";
        public const string ICON_CHECK = "M3,8.5 L6.5,12 L13.5,4.5";

        public static Button MakeFlatButton(
            UIElement content,
            PaperPalette palette,
            string tooltip,
            Thickness padding,
            double cornerRadius,
            Brush borderBrush,
            Brush normalBg,
            Brush hoverBg
        )
        {
            Button btn = new Button();
            btn.Content = content;
            btn.ToolTip = tooltip;
            btn.Padding = padding;
            btn.Cursor = Cursors.Hand;
            btn.BorderThickness = borderBrush != null ? new Thickness(1) : new Thickness(0);
            btn.BorderBrush = borderBrush ?? Brushes.Transparent;
            btn.Background = normalBg ?? Brushes.Transparent;
            btn.Focusable = false;

            ControlTemplate tpl = new ControlTemplate(typeof(Button));
            FrameworkElementFactory bd = new FrameworkElementFactory(typeof(Border));
            bd.Name = "bd";
            bd.SetValue(Border.BackgroundProperty, new TemplateBindingExtension(Control.BackgroundProperty));
            bd.SetValue(Border.BorderBrushProperty, new TemplateBindingExtension(Control.BorderBrushProperty));
            bd.SetValue(Border.BorderThicknessProperty, new TemplateBindingExtension(Control.BorderThicknessProperty));
            bd.SetValue(Border.CornerRadiusProperty, new CornerRadius(cornerRadius));
            bd.SetValue(Border.PaddingProperty, new TemplateBindingExtension(Control.PaddingProperty));

            FrameworkElementFactory cp = new FrameworkElementFactory(typeof(ContentPresenter));
            cp.SetValue(FrameworkElement.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            cp.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);
            bd.AppendChild(cp);
            tpl.VisualTree = bd;

            Trigger hover = new Trigger();
            hover.Property = UIElement.IsMouseOverProperty;
            hover.Value = true;
            hover.Setters.Add(new Setter(Border.BackgroundProperty, hoverBg ?? palette.PaperHover, "bd"));
            tpl.Triggers.Add(hover);

            btn.Template = tpl;
            return btn;
        }

        public static Grid MakePlaceholderTextBox(
            string placeholder,
            PaperPalette palette,
            double fontSize,
            bool multiline,
            out TextBox textBox,
            out TextBlock placeholderBlock
        )
        {
            Grid host = new Grid();

            TextBlock ph = new TextBlock();
            ph.Text = placeholder;
            ph.FontFamily = PaperPalette.SansFont;
            ph.FontSize = fontSize;
            ph.Foreground = palette.InkMuted;
            ph.VerticalAlignment = multiline ? VerticalAlignment.Top : VerticalAlignment.Center;
            ph.Margin = multiline ? new Thickness(4, 3, 4, 0) : new Thickness(2, 0, 2, 0);
            ph.IsHitTestVisible = false;

            TextBox tb = new TextBox();
            tb.FontFamily = PaperPalette.SansFont;
            tb.FontSize = fontSize;
            tb.Foreground = palette.InkPrimary;
            tb.CaretBrush = palette.InkPrimary;
            tb.SelectionBrush = palette.AccentSoft;
            tb.Background = Brushes.Transparent;
            tb.BorderThickness = new Thickness(0);
            tb.VerticalContentAlignment = multiline ? VerticalAlignment.Top : VerticalAlignment.Center;
            tb.Padding = multiline ? new Thickness(2, 2, 2, 2) : new Thickness(0, 2, 0, 2);
            if (multiline)
            {
                tb.AcceptsReturn = true;
                tb.TextWrapping = TextWrapping.Wrap;
                tb.MinHeight = 46;
            }

            tb.TextChanged += delegate
            {
                ph.Visibility = string.IsNullOrEmpty(tb.Text) ? Visibility.Visible : Visibility.Collapsed;
            };

            host.Children.Add(ph);
            host.Children.Add(tb);

            textBox = tb;
            placeholderBlock = ph;
            return host;
        }
    }
}
