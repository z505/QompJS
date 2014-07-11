Original Oberon-O7 allows to change procedure arguments (to use them as ordinary variables) unless they are non-VAR ARRAY or RECORD. Eberon makes this rule more consistent - all non-VAR arguments are read-only.
This restriction is introduced in the first place to support [[implicit type narrowing|eberon-implicit-type-narrowing]] for POINTER arguments. But anyway reusing arguments as variables I personally consider as a bad practice because their scope is a whole procedure and possibility of modifing requires more attention while reading.