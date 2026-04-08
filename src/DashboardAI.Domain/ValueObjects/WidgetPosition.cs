using System;

namespace DashboardAI.Domain.ValueObjects
{
    /// <summary>
    /// Immutable GridStack position/size descriptor for a widget on the canvas.
    /// </summary>
    public class WidgetPosition : IEquatable<WidgetPosition>
    {
        public int X { get; }   // column start (0-based)
        public int Y { get; }   // row start (0-based)
        public int W { get; }   // width in columns (GridStack units, max 12)
        public int H { get; }   // height in rows

        public WidgetPosition(int x, int y, int w, int h)
        {
            if (w < 1 || w > 12)    throw new ArgumentOutOfRangeException(nameof(w), "Width must be 1-12.");
            if (h < 1)              throw new ArgumentOutOfRangeException(nameof(h), "Height must be >= 1.");

            X = x; Y = y; W = w; H = h;
        }

        public bool Equals(WidgetPosition other)
            => other != null && X == other.X && Y == other.Y && W == other.W && H == other.H;

        public override bool Equals(object obj) => Equals(obj as WidgetPosition);

        public override int GetHashCode()
            => HashCode.Combine(X, Y, W, H);

        public override string ToString() => $"[x={X}, y={Y}, w={W}, h={H}]";
    }
}
