using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace DashboardAI.Application.Converters
{
    /// <summary>
    /// Tolerant JSON converter for string properties.
    /// If the AI returns an object {}, array [], or null where a plain string is expected,
    /// this converter silently coerces the value to an empty string instead of throwing.
    /// </summary>
    public class ForgivingStringConverter : JsonConverter<string>
    {
        public override string ReadJson(JsonReader reader, Type objectType, string existingValue, bool hasExistingValue, JsonSerializer serializer)
        {
            var token = JToken.Load(reader);
            switch (token.Type)
            {
                case JTokenType.String:
                    return token.Value<string>();
                case JTokenType.Null:
                case JTokenType.None:
                case JTokenType.Undefined:
                    return string.Empty;
                case JTokenType.Object:
                case JTokenType.Array:
                    // AI sent {} or [] — coerce to empty string
                    return string.Empty;
                default:
                    // Numbers, booleans, etc. — convert to string representation
                    return token.ToString();
            }
        }

        public override void WriteJson(JsonWriter writer, string value, JsonSerializer serializer)
        {
            writer.WriteValue(value ?? string.Empty);
        }
    }
}
