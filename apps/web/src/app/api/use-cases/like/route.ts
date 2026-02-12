import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { postId, visitorId } = body;

    if (!postId || typeof postId !== "string") {
      return NextResponse.json(
        { error: "postId is required" },
        { status: 400 }
      );
    }

    if (!visitorId || typeof visitorId !== "string") {
      return NextResponse.json(
        { error: "visitorId is required" },
        { status: 400 }
      );
    }

    const supabase = getServiceSupabase();

    // Check if the post exists
    const { data: post, error: postError } = await supabase
      .from("moa_usecase_posts")
      .select("id, like_count")
      .eq("id", postId)
      .single();

    if (postError || !post) {
      return NextResponse.json(
        { error: "Post not found" },
        { status: 404 }
      );
    }

    // Check if like already exists
    const { data: existingLike } = await supabase
      .from("moa_usecase_likes")
      .select("id")
      .eq("post_id", postId)
      .eq("visitor_id", visitorId)
      .single();

    let newLikeCount: number;

    if (existingLike) {
      // Unlike: remove the like and recount
      await supabase
        .from("moa_usecase_likes")
        .delete()
        .eq("id", existingLike.id);

      // Recount from source of truth to avoid race conditions
      const { count: actualCount } = await supabase
        .from("moa_usecase_likes")
        .select("id", { count: "exact", head: true })
        .eq("post_id", postId);

      newLikeCount = actualCount ?? 0;

      await supabase
        .from("moa_usecase_posts")
        .update({ like_count: newLikeCount })
        .eq("id", postId);
    } else {
      // Like: insert the like and recount
      const { error: insertError } = await supabase
        .from("moa_usecase_likes")
        .insert({ post_id: postId, visitor_id: visitorId });

      if (insertError) {
        // Likely a duplicate; re-fetch current count
        const { count: actualCount } = await supabase
          .from("moa_usecase_likes")
          .select("id", { count: "exact", head: true })
          .eq("post_id", postId);
        return NextResponse.json({
          liked: true,
          likeCount: actualCount ?? (post.like_count ?? 0),
        });
      }

      // Recount from source of truth to avoid race conditions
      const { count: actualCount } = await supabase
        .from("moa_usecase_likes")
        .select("id", { count: "exact", head: true })
        .eq("post_id", postId);

      newLikeCount = actualCount ?? ((post.like_count ?? 0) + 1);

      await supabase
        .from("moa_usecase_posts")
        .update({ like_count: newLikeCount })
        .eq("id", postId);
    }

    return NextResponse.json({
      liked: !existingLike,
      likeCount: newLikeCount,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
