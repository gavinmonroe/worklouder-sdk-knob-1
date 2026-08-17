/*
 * Framer's deliberately small MicroQuickJS ROM library generator.
 *
 * The engine still implements the JavaScript language internally, but the
 * only product-specific native surface exposed to widget code is `widget`.
 * There is no clock, random source, console, filesystem loader, timer, or
 * native eval function in this library.
 */
#include "mquickjs_build.h"

static const JSPropDef js_object_proto[] = {
    JS_CFUNC_DEF("hasOwnProperty", 1, js_object_hasOwnProperty),
    JS_CFUNC_DEF("toString", 0, js_object_toString),
    JS_PROP_END,
};

static const JSClassDef js_object_class =
    JS_CLASS_DEF("Object", 1, js_object_constructor, JS_CLASS_OBJECT,
                 NULL, js_object_proto, NULL, NULL);

static const JSPropDef js_number_proto[] = {
    JS_CFUNC_DEF("toString", 1, js_number_toString),
    JS_PROP_END,
};

static const JSClassDef js_number_class =
    JS_CLASS_DEF("Number", 1, js_number_constructor, JS_CLASS_NUMBER,
                 NULL, js_number_proto, NULL, NULL);

static const JSClassDef js_boolean_class =
    JS_CLASS_DEF("Boolean", 1, js_boolean_constructor, JS_CLASS_BOOLEAN,
                 NULL, NULL, NULL, NULL);

static const JSPropDef js_string_proto[] = {
    JS_CGETSET_DEF("length", js_string_get_length, js_string_set_length),
    JS_CFUNC_DEF("slice", 2, js_string_slice),
    JS_CFUNC_DEF("toString", 0, js_string_toString),
    JS_PROP_END,
};

static const JSClassDef js_string_class =
    JS_CLASS_DEF("String", 1, js_string_constructor, JS_CLASS_STRING,
                 NULL, js_string_proto, NULL, NULL);

static const JSPropDef js_array_proto[] = {
    JS_CGETSET_DEF("length", js_array_get_length, js_array_set_length),
    JS_CFUNC_MAGIC_DEF("push", 1, js_array_push, 0),
    JS_CFUNC_DEF("pop", 0, js_array_pop),
    JS_PROP_END,
};

static const JSClassDef js_array_class =
    JS_CLASS_DEF("Array", 1, js_array_constructor, JS_CLASS_ARRAY,
                 NULL, js_array_proto, NULL, NULL);

static const JSPropDef js_error_proto[] = {
    JS_PROP_STRING_DEF("name", "Error", 0),
    JS_CGETSET_MAGIC_DEF("message", js_error_get_message, NULL, 0),
    JS_PROP_END,
};

static const JSClassDef js_error_class =
    JS_CLASS_MAGIC_DEF("Error", 1, js_error_constructor, JS_CLASS_ERROR,
                       NULL, js_error_proto, NULL, NULL);

#define ERROR_DEF(cname, name, class_id)                                      \
    static const JSPropDef js_##cname##_proto[] = {                           \
        JS_PROP_STRING_DEF("name", name, 0),                                  \
        JS_PROP_END,                                                           \
    };                                                                         \
    static const JSClassDef js_##cname##_class =                              \
        JS_CLASS_MAGIC_DEF(name, 1, js_error_constructor, class_id, NULL,     \
                           js_##cname##_proto, &js_error_class, NULL)

ERROR_DEF(eval_error, "EvalError", JS_CLASS_EVAL_ERROR);
ERROR_DEF(range_error, "RangeError", JS_CLASS_RANGE_ERROR);
ERROR_DEF(reference_error, "ReferenceError", JS_CLASS_REFERENCE_ERROR);
ERROR_DEF(syntax_error, "SyntaxError", JS_CLASS_SYNTAX_ERROR);
ERROR_DEF(type_error, "TypeError", JS_CLASS_TYPE_ERROR);
ERROR_DEF(uri_error, "URIError", JS_CLASS_URI_ERROR);
ERROR_DEF(internal_error, "InternalError", JS_CLASS_INTERNAL_ERROR);

static const JSPropDef js_widget[] = {
    JS_CFUNC_DEF("on", 2, js_framer_on),
    JS_CFUNC_DEF("getInt", 1, js_framer_get_int),
    JS_CFUNC_DEF("setInt", 2, js_framer_set_int),
    JS_CFUNC_DEF("commit", 0, js_framer_commit),
    JS_CFUNC_DEF("isHeld", 2, js_framer_is_held),
    JS_PROP_END,
};

static const JSClassDef js_widget_object =
    JS_OBJECT_DEF("widget", js_widget);

static const JSPropDef js_global_object[] = {
    JS_PROP_CLASS_DEF("Object", &js_object_class),
    JS_PROP_CLASS_DEF("Number", &js_number_class),
    JS_PROP_CLASS_DEF("Boolean", &js_boolean_class),
    JS_PROP_CLASS_DEF("String", &js_string_class),
    JS_PROP_CLASS_DEF("Array", &js_array_class),
    JS_PROP_CLASS_DEF("Error", &js_error_class),
    JS_PROP_CLASS_DEF("EvalError", &js_eval_error_class),
    JS_PROP_CLASS_DEF("RangeError", &js_range_error_class),
    JS_PROP_CLASS_DEF("ReferenceError", &js_reference_error_class),
    JS_PROP_CLASS_DEF("SyntaxError", &js_syntax_error_class),
    JS_PROP_CLASS_DEF("TypeError", &js_type_error_class),
    JS_PROP_CLASS_DEF("URIError", &js_uri_error_class),
    JS_PROP_CLASS_DEF("InternalError", &js_internal_error_class),
    JS_PROP_UNDEFINED_DEF("undefined", 0),
    JS_PROP_CLASS_DEF("widget", &js_widget_object),
    JS_PROP_END,
};

int main(int argc, char **argv)
{
    return build_atoms("js_stdlib", js_global_object, NULL, argc, argv);
}
