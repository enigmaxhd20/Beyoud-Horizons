title @s[tag=L] title §3Wellcome Back
give @s[tag=!L] apple 1 0 {"minecraft:item_lock":{"mode":"lock_in_slot"}}
execute as @s[tag=!L] at @s run title @s title §6Wellcome
execute as @s[tag=!L] at @s run title @s subtitle §eYou are now a member of the §6Beyond Horizon§e!
execute as @s[tag=!L] at @s run tag @s add L